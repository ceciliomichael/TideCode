import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getHistoryDirectoryPath } from '../../history/paths'
import type { ChatCompactionDetailSection, ChatCompactionMarker, ChatStreamCancellation, Message } from '../../../src/types/chat'
import {
  createEmptyCanonicalHistory,
  getReplaySlotKey,
  type CanonicalHistoryDocument,
  type CanonicalHistoryEvent,
  type CanonicalPromptContext,
  type CanonicalReplayProjection,
  type CanonicalReasoningRetention,
  type ProviderStepRecord,
} from './contracts'
import { decodeReplayValue, encodeModelMessages, encodeReplayValue } from './replayCodec'
import { parseCanonicalHistoryDocument } from './validation'
import type { ModelMessage } from 'ai'
import { sha256, stableStringify } from '../cache/canonicalization'
import { carryCompletedReplaysAcrossBranch, resolveReplayStateAfterHistoryRewrite } from './branchReplay'
import { getBranchHistoryEvents, getHistoryCutoffRevision } from './branchContext'
import {
  sanitizeCompactedModelMessages,
  sanitizeModelMessages,
} from '../shared/modelMessageIntegrity'
import { stripExecutionModeContext } from '../../../src/lib/executionModeContext'
import { parseCompactionPacket, type CompactionPacket } from '../shared/compaction/contracts'
import { parseConversationMemory, type ConversationMemory } from '../shared/compaction/durableMemory'
import {
  buildContinuationMarkdownFromPacket,
  repairCompactionPacketContinuation,
  validateContinuationMarkdown,
} from '../shared/compaction/markdown'
import { withFileLock } from './fileLock'
import { shouldPreserveNewerCompactionReplay } from './replayWritePolicy'
import type { CompactionAttemptDiagnostic } from '../shared/compaction/contracts'
import { CompactionError } from '../shared/compaction/gate'

const CANONICAL_DIRECTORY_NAME = 'canonical-history'
const updateQueues = new Map<string, Promise<void>>()

function getCanonicalDirectoryPath() {
  return path.join(getHistoryDirectoryPath(), CANONICAL_DIRECTORY_NAME)
}

function getCanonicalHistoryPath(conversationId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(conversationId)) {
    throw new Error('Invalid conversation id for canonical history storage.')
  }
  return path.join(getCanonicalDirectoryPath(), `${conversationId}.json`)
}

async function ensureCanonicalDirectory() {
  await fs.mkdir(getCanonicalDirectoryPath(), { recursive: true })
}

async function writeAtomic(filePath: string, content: string) {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  const backupPath = `${filePath}.bak`
  await fs.writeFile(tempPath, content, 'utf8')
  try {
    await fs.rename(tempPath, filePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  await fs.unlink(backupPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  let hadExistingTarget = true
  try {
    await fs.rename(filePath, backupPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') hadExistingTarget = false
    else throw error
  }
  try {
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined)
    if (hadExistingTarget) await fs.rename(backupPath, filePath).catch(() => undefined)
    throw error
  }
  await fs.unlink(backupPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

async function readDocumentUnsafe(conversationId: string): Promise<CanonicalHistoryDocument> {
  const filePath = getCanonicalHistoryPath(conversationId)
  const backupPath = `${filePath}.bak`
  try {
    return parseCanonicalHistoryDocument(await fs.readFile(filePath, 'utf8'), conversationId)
  } catch (error) {
    try {
      return parseCanonicalHistoryDocument(await fs.readFile(backupPath, 'utf8'), conversationId)
    } catch (backupError) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        (backupError as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return createEmptyCanonicalHistory(conversationId)
      }

      const quarantinePath = `${filePath}.corrupt-${Date.now()}`
      await fs.rename(filePath, quarantinePath).catch(() => undefined)
      await fs.rename(backupPath, `${quarantinePath}.bak`).catch(() => undefined)
      console.error(`Canonical history was invalid and has been quarantined: ${filePath}`, error, backupError)
      return createEmptyCanonicalHistory(conversationId)
    }
  }
}

function appendEvent(
  document: CanonicalHistoryDocument,
  event: NewCanonicalHistoryEvent,
) {
  const revision = document.revision + 1
  const nextEvent = {
    ...event,
    branchId: document.activeBranchId,
    createdAt: Date.now(),
    eventId: randomUUID(),
    revision,
  } as CanonicalHistoryEvent
  document.revision = revision
  document.updatedAt = nextEvent.createdAt
  document.events.push(nextEvent)
  return nextEvent
}

type NewCanonicalHistoryEvent = CanonicalHistoryEvent extends infer Event
  ? Event extends CanonicalHistoryEvent
    ? Omit<Event, 'branchId' | 'createdAt' | 'eventId' | 'revision'>
    : never
  : never

async function updateDocument(
  conversationId: string,
  updater: (document: CanonicalHistoryDocument) => boolean | void | Promise<boolean | void>,
) {
  const previous = updateQueues.get(conversationId) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  updateQueues.set(conversationId, queued)

  await previous
  try {
    await ensureCanonicalDirectory()
    const historyPath = getCanonicalHistoryPath(conversationId)
    return await withFileLock(`${historyPath}.lock`, async () => {
      const document = await readDocumentUnsafe(conversationId)
      const shouldWrite = await updater(document)
      if (shouldWrite === false) {
        return document
      }
      await writeAtomic(historyPath, JSON.stringify(document, null, 2))
      return document
    })
  } finally {
    release()
    if (updateQueues.get(conversationId) === queued) {
      updateQueues.delete(conversationId)
    }
  }
}

export async function readCanonicalHistory(conversationId: string) {
  await ensureCanonicalDirectory()
  return readDocumentUnsafe(conversationId)
}

export async function readLatestCompactionPacket(conversationId: string): Promise<CompactionPacket | null> {
  const document = await readCanonicalHistory(conversationId)
  for (const event of getBranchHistoryEvents(document).reverse()) {
    if (
      event.type !== 'compaction_committed' ||
      !('packet' in event)
    ) {
      continue
    }
    try {
      const packet = parseCompactionPacket(decodeReplayValue(event.packet))
      if (packet) return repairCompactionPacketContinuation(packet)
    } catch {
      continue
    }
  }
  return null
}

export async function readLatestConversationMemory(conversationId: string): Promise<ConversationMemory | null> {
  const document = await readCanonicalHistory(conversationId)
  for (const event of getBranchHistoryEvents(document).reverse()) {
    if (
      event.type !== 'compaction_committed' ||
      !('durableMemory' in event) ||
      event.durableMemory === undefined
    ) {
      continue
    }

    try {
      const memory = parseConversationMemory(decodeReplayValue(event.durableMemory))
      if (memory) return memory
    } catch {
      continue
    }
  }
  return null
}

export async function listCompactionMarkers(conversationId: string): Promise<ChatCompactionMarker[]> {
  const document = await readCanonicalHistory(conversationId)
  return getBranchHistoryEvents(document)
    .flatMap((event) => {
      if (
        event.type !== 'compaction_committed' ||
        !('compactionId' in event)
      ) {
        return []
      }

      return [{
        anchorUserMessageId: event.anchorUserMessageId,
        compactionId: event.compactionId,
        createdAt: event.createdAt,
        detailSections: buildCompactionDetailSections(event.packet),
      }]
    })
}

function buildCompactionDetailSections(encodedPacket: Parameters<typeof decodeReplayValue>[0]): ChatCompactionDetailSection[] {
  try {
    const packet = parseCompactionPacket(decodeReplayValue(encodedPacket))
    const continuationMarkdown = packet
      ? (() => {
          const repairedPacket = repairCompactionPacketContinuation(packet)
          const validation = validateContinuationMarkdown(repairedPacket.continuationMarkdown)
          return validation.valid
            ? stripExecutionModeContext(validation.normalized).trim().slice(0, 32_000)
            : buildContinuationMarkdownFromPacket(repairedPacket)
        })()
      : ''
    return continuationMarkdown.length > 0
      ? [{ items: [continuationMarkdown] }]
      : []
  } catch {
    return []
  }
}

export async function synchronizeCanonicalMessages(conversationId: string, messages: Message[], previousMessages?: Message[]) {
  return updateDocument(conversationId, (document) => {
    const messageIds = messages.map((message) => message.id)
    const messageDigests = messages.map((message) => sha256(stableStringify(message)))
    const priorIds = document.synchronizedMessageIds
    const priorDigests = document.synchronizedMessageDigests
    const historyIsUnchanged =
      priorIds.length === messageIds.length &&
      priorIds.every((id, index) => messageIds[index] === id && priorDigests[index] === messageDigests[index])
    const displayWasRewritten = previousMessages !== undefined && previousMessages.some((message, index) => (
      messages[index]?.id !== message.id || stableStringify(messages[index]) !== stableStringify(message)
    ))
    if (historyIsUnchanged && !displayWasRewritten) {
      return false
    }
    const priorIsPrefix = priorIds.every((id, index) => (
      messageIds[index] === id && priorDigests[index] === messageDigests[index]
    ))

    if ((!priorIsPrefix && priorIds.length > 0) || displayWasRewritten) {
      const retainedThroughRevision = getHistoryCutoffRevision(document, messages, previousMessages)
      const previousBranchId = document.activeBranchId
      document.activeBranchId = randomUUID()
      const wasEdited = priorIds.some((id, index) => (
        messageIds[index] === id && priorDigests[index] !== messageDigests[index]
      ))
      const carriedReplayState = resolveReplayStateAfterHistoryRewrite({
        activeBranchId: document.activeBranchId,
        messageIds,
        replay: document.replay,
        replays: document.replays,
        wasEdited,
        retainedThroughRevision,
        sourceBranchId: previousBranchId,
      })
      document.replays = carriedReplayState.replays
      document.replay = carriedReplayState.replay
      appendEvent(document, {
        fromBranchId: previousBranchId,
        retainedThroughRevision,
        reason: wasEdited ? 'edited' : 'history_replaced',
        runId: null,
        type: 'branch_created',
      })
    }

    document.synchronizedMessageDigests = messageDigests
    document.synchronizedMessageIds = messageIds
    appendEvent(document, {
      messageIds,
      runId: null,
      type: 'messages_synchronized',
    })
  })
}

/** Seed an independent chat before publishing its visible conversation file. */
export async function initializeCanonicalBranch(
  conversationId: string,
  sourceConversationId: string,
  sourceMessages: Message[],
  messages: Message[],
) {
  const source = await readCanonicalHistory(sourceConversationId)
  const retainedThroughRevision = getHistoryCutoffRevision(source, messages, sourceMessages)
  const messageIds = new Set(messages.map((message) => message.id))
  await updateDocument(conversationId, (document) => {
    document.contextFingerprint = source.contextFingerprint
    document.promptContext = source.promptContext
    document.events = getBranchHistoryEvents(source).filter((event) => (
      event.revision <= retainedThroughRevision && event.type !== 'branch_created' &&
      (!('anchorUserMessageId' in event) || event.anchorUserMessageId === null || messageIds.has(event.anchorUserMessageId))
    )).map((event) => ({ ...event, branchId: document.activeBranchId, eventId: randomUUID() }))
    document.revision = document.events.at(-1)?.revision ?? 0
    const carried = carryCompletedReplaysAcrossBranch({
      activeBranchId: document.activeBranchId,
      messageIds: [...messageIds],
      replay: source.replay,
      replays: source.replays,
      retainedThroughRevision,
      sourceBranchId: source.activeBranchId,
    })
    document.replay = carried.replay
    document.replays = carried.replays
    document.synchronizedMessageIds = [...messageIds]
    document.synchronizedMessageDigests = messages.map((message) => sha256(stableStringify(message)))
    appendEvent(document, { type: 'messages_synchronized', runId: null, messageIds: [...messageIds] })
  })
}

export async function recordContextEpoch(conversationId: string, promptContext: CanonicalPromptContext) {
  return updateDocument(conversationId, (document) => {
    const contextFingerprint = promptContext.fingerprint
    if (document.contextFingerprint === contextFingerprint) return false
    const previousContextFingerprint = document.contextFingerprint
    const previousPromptContext = document.promptContext
    document.contextFingerprint = contextFingerprint
    document.promptContext = promptContext
    const changeReasons: Array<'model' | 'system' | 'tools'> = []
    if (previousPromptContext?.modelHash !== promptContext.modelHash) changeReasons.push('model')
    if (previousPromptContext?.systemHash !== promptContext.systemHash) changeReasons.push('system')
    if (previousPromptContext?.toolsHash !== promptContext.toolsHash) changeReasons.push('tools')
    appendEvent(document, {
      changeReasons,
      contextFingerprint,
      previousContextFingerprint,
      promptContext,
      runId: null,
      type: 'context_epoch_changed',
    })
  })
}

export async function recordRunStarted(input: {
  anchorUserMessageId: string | null
  contextFingerprint: string
  conversationId: string
  fidelity: CanonicalReplayProjection['fidelity']
  initialMessages: ModelMessage[]
  modelId: string
  providerId: CanonicalReplayProjection['providerId']
  runId: string
}) {
  return updateDocument(input.conversationId, (document) => {
    appendEvent(document, {
      anchorUserMessageId: input.anchorUserMessageId,
      contextFingerprint: input.contextFingerprint,
      fidelity: input.fidelity,
      initialMessages: encodeModelMessages(sanitizeModelMessages(input.initialMessages)),
      modelId: input.modelId,
      providerId: input.providerId,
      runId: input.runId,
      type: 'run_started',
    })
  })
}

export function captureCompactionSource(document: CanonicalHistoryDocument) {
  const relevant = getBranchHistoryEvents(document).filter((event) => (
    event.type !== 'observation_recorded' && event.type !== 'observation_invalidated'
    && event.type !== 'compaction_attempted'
  ))
  return { branchId: document.activeBranchId, sourceRevision: relevant.at(-1)?.revision ?? 0 }
}

export async function recordCompactionAttempt(conversationId: string, runId: string | null, diagnostic: CompactionAttemptDiagnostic) {
  return updateDocument(conversationId, (document) => {
    appendEvent(document, { type: 'compaction_attempted', runId, diagnostic })
  })
}

export async function recordCompactionCommitted(input: {
  expectedSource?: ReturnType<typeof captureCompactionSource>
  signal?: AbortSignal
  runId?: string | null
  diagnostic?: CompactionAttemptDiagnostic
  anchorUserMessageId: string | null
  compactionId: string
  conversationId: string
  contextFingerprint?: string | null
  degradedDiagnostics?: string[]
  durableMemory?: ConversationMemory
  modelId: string
  parentPacketId?: string | null
  packet: unknown
  projectionVersion?: string
  projectedMessages: ModelMessage[]
  providerId: CanonicalReplayProjection['providerId']
  reasoningRetention?: CanonicalReasoningRetention
  sourceDigest: string
  sourceMessageIds: string[]
  usedFallback?: boolean
}) {
  return updateDocument(input.conversationId, (document) => {
    if (input.signal?.aborted) {
      throw new CompactionError('aborted')
    }
    if (input.expectedSource) {
      const current = captureCompactionSource(document)
      if (current.branchId !== input.expectedSource.branchId || current.sourceRevision !== input.expectedSource.sourceRevision) {
        throw new CompactionError('stale_source')
      }
    }
    if (input.diagnostic) {
      appendEvent(document, { type: 'compaction_attempted', runId: input.runId ?? null, diagnostic: input.diagnostic })
    }
    const compactionSequence = document.events.filter((event) => (
      event.branchId === document.activeBranchId && event.type === 'compaction_committed' && 'compactionId' in event
    )).length + 1
    appendEvent(document, {
      anchorUserMessageId: input.anchorUserMessageId,
      compactionId: input.compactionId,
      compactionSequence,
      contextFingerprint: input.contextFingerprint ?? document.contextFingerprint,
      ...(input.degradedDiagnostics ? { degradedDiagnostics: input.degradedDiagnostics } : {}),
      ...(input.durableMemory ? { durableMemory: encodeReplayValue(input.durableMemory) } : {}),
      modelId: input.modelId,
      parentPacketId: input.parentPacketId ?? null,
      packet: encodeReplayValue(input.packet),
      projectionVersion: input.projectionVersion ?? 'tidecode.compaction_projection/v2',
      projectedMessages: encodeModelMessages(sanitizeCompactedModelMessages(input.projectedMessages)),
      providerId: input.providerId,
      ...(input.reasoningRetention ? { reasoningRetention: input.reasoningRetention } : {}),
      runId: input.runId ?? null,
      sourceDigest: input.sourceDigest,
      sourceMessageIds: input.sourceMessageIds,
      type: 'compaction_committed',
      usedFallback: input.usedFallback ?? false,
    })
  })
}

export async function recordStepCompleted(conversationId: string, runId: string, step: ProviderStepRecord) {
  return updateDocument(conversationId, (document) => {
    appendEvent(document, {
      finishReason: step.finishReason,
      providerMetadata: step.providerMetadata == null ? null : encodeReplayValue(step.providerMetadata),
      responseMessages: encodeReplayValue(step.responseMessages),
      runId,
      stepNumber: step.stepNumber,
      durationMs: step.durationMs,
      type: 'step_completed',
      usage: step.usage,
      ...(step.contextUsage ? { contextUsage: step.contextUsage } : {}),
    })
    document.usage = {
      cacheHitSteps: document.usage.cacheHitSteps + (step.usage.reporting?.cacheRead === 'reported' && step.usage.cacheReadTokens > 0 ? 1 : 0),
      reportedCacheSteps: (document.usage.reportedCacheSteps ?? 0) + (step.usage.reporting?.cacheRead === 'reported' ? 1 : 0),
      reportedCacheHitSteps: (document.usage.reportedCacheHitSteps ?? 0) + (step.usage.reporting?.cacheRead === 'reported' && step.usage.cacheReadTokens > 0 ? 1 : 0),
      reportedCacheInputTokens: (document.usage.reportedCacheInputTokens ?? 0) + (step.usage.reporting?.cacheRead === 'reported' ? step.usage.inputTokens : 0),
      reportedCacheReadTokens: (document.usage.reportedCacheReadTokens ?? 0) + (step.usage.reporting?.cacheRead === 'reported' ? step.usage.cacheReadTokens : 0),
      cacheReadTokens: document.usage.cacheReadTokens + step.usage.cacheReadTokens,
      cacheWriteTokens: document.usage.cacheWriteTokens + step.usage.cacheWriteTokens,
      inputTokens: document.usage.inputTokens + step.usage.inputTokens,
      noCacheTokens: document.usage.noCacheTokens + step.usage.noCacheTokens,
      outputTokens: document.usage.outputTokens + step.usage.outputTokens,
      reasoningTokens: document.usage.reasoningTokens + step.usage.reasoningTokens,
      stepCount: document.usage.stepCount + 1,
      totalDurationMs: document.usage.totalDurationMs + step.durationMs,
      totalTokens: document.usage.totalTokens + step.usage.totalTokens,
    }
  })
}

export async function recordRunCompleted(input: {
  anchorUserMessageId: string | null
  compactionId?: string | null
  contextFingerprint: string
  conversationId: string
  freshnessRevision: number
  fidelity: CanonicalReplayProjection['fidelity']
  messages: ModelMessage[]
  modelId: string
  providerId: CanonicalReplayProjection['providerId']
  runId: string
}) {
  return updateDocument(input.conversationId, (document) => {
    const preserveNewerCompaction = shouldPreserveNewerCompactionReplay({
      activeBranchId: document.activeBranchId,
      compactionId: input.compactionId,
      events: document.events,
      runId: input.runId,
    })
    const completedEvent = appendEvent(document, {
      runId: input.runId,
      type: 'run_completed',
    })
    if (preserveNewerCompaction) return

    document.replay = {
      anchorUserMessageId: input.anchorUserMessageId,
      branchId: document.activeBranchId,
      contextFingerprint: input.contextFingerprint,
      fidelity: input.fidelity,
      freshnessRevision: input.freshnessRevision,
      messages: encodeModelMessages(sanitizeModelMessages(input.messages)),
      modelId: input.modelId,
      providerId: input.providerId,
      runId: input.runId,
      sourceRevision: completedEvent.revision,
      updatedAt: completedEvent.createdAt,
    }
    document.replays[getReplaySlotKey(input.providerId, input.modelId)] = document.replay
  })
}

export async function recordRunTerminal(
  conversationId: string,
  runId: string,
  type: 'run_aborted' | 'run_failed',
  reason: string,
  cancellation?: ChatStreamCancellation,
) {
  return updateDocument(conversationId, (document) => {
    appendEvent(document, { ...(cancellation ? { cancellation } : {}), reason, runId, type })
  })
}

export async function recordToolFreshness(input: {
  conversationId: string
  status: 'error' | 'success'
  subject?: { path?: string }
  toolName: string
}) {
  if (input.status !== 'success') return
  const isTerminalTool = input.toolName.toLowerCase().includes('terminal')
  const subject = input.subject?.path?.trim() || (isTerminalTool ? 'workspace:*' : '')
  if (!subject) return

  return updateDocument(input.conversationId, (document) => {
    const invalidated = new Set(document.freshness.invalidatedSubjects)
    const mutationTools = new Set([
      'write',
      'patch',
    ])
    const type = mutationTools.has(input.toolName) || isTerminalTool
      ? 'observation_invalidated'
      : 'observation_recorded'

    if (type === 'observation_invalidated') invalidated.add(subject)
    else {
      invalidated.delete(subject)
      invalidated.delete('workspace:*')
    }
    document.freshness = {
      invalidatedSubjects: Array.from(invalidated).sort(),
      revision: document.freshness.revision + 1,
    }
    appendEvent(document, { runId: null, subject, toolName: input.toolName, type })
  })
}

export async function deleteCanonicalHistory(conversationId: string) {
  try {
    await fs.unlink(getCanonicalHistoryPath(conversationId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
