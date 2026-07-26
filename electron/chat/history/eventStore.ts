import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getHistoryDirectoryPath } from '../../history/paths'
import type { Message } from '../../../src/types/chat'
import {
  createEmptyCanonicalHistory,
  getReplaySlotKey,
  type CanonicalHistoryDocument,
  type CanonicalHistoryEvent,
  type CanonicalPromptContext,
  type CanonicalReplayProjection,
  type ProviderStepRecord,
} from './contracts'
import { encodeModelMessages, encodeReplayValue } from './replayCodec'
import { parseCanonicalHistoryDocument } from './validation'
import type { ModelMessage } from 'ai'
import { sha256, stableStringify } from '../cache/canonicalization'

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
    const document = await readDocumentUnsafe(conversationId)
    const shouldWrite = await updater(document)
    if (shouldWrite === false) {
      return document
    }
    await writeAtomic(getCanonicalHistoryPath(conversationId), JSON.stringify(document, null, 2))
    return document
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

export async function synchronizeCanonicalMessages(conversationId: string, messages: Message[]) {
  return updateDocument(conversationId, (document) => {
    const messageIds = messages.map((message) => message.id)
    const messageDigests = messages.map((message) => sha256(stableStringify(message)))
    const priorIds = document.synchronizedMessageIds
    const priorDigests = document.synchronizedMessageDigests
    const historyIsUnchanged =
      priorIds.length === messageIds.length &&
      priorIds.every((id, index) => messageIds[index] === id && priorDigests[index] === messageDigests[index])
    if (historyIsUnchanged) {
      return false
    }
    const priorIsPrefix = priorIds.every((id, index) => (
      messageIds[index] === id && priorDigests[index] === messageDigests[index]
    ))

    if (!priorIsPrefix && priorIds.length > 0) {
      const previousBranchId = document.activeBranchId
      document.activeBranchId = randomUUID()
      const wasEdited = priorIds.some((id, index) => (
        messageIds[index] === id && priorDigests[index] !== messageDigests[index]
      ))
      const retryAnchorId = [...messages].reverse().find((message) => message.role === 'user')?.id ?? null
      const retryEvent = wasEdited || !retryAnchorId
        ? null
        : [...document.events].reverse().find((event) => (
            event.type === 'run_started' && event.anchorUserMessageId === retryAnchorId
          ))
      document.replays = {}
      if (!wasEdited && retryAnchorId) {
        for (const event of [...document.events].reverse()) {
          if (event.type !== 'run_started' || event.anchorUserMessageId !== retryAnchorId) continue
          const slotKey = getReplaySlotKey(event.providerId, event.modelId)
          if (document.replays[slotKey]) continue
          document.replays[slotKey] = {
            anchorUserMessageId: retryAnchorId,
            branchId: document.activeBranchId,
            contextFingerprint: event.contextFingerprint,
            fidelity: event.fidelity,
            freshnessRevision: document.freshness.revision,
            messages: event.initialMessages,
            modelId: event.modelId,
            providerId: event.providerId,
            runId: event.runId ?? event.eventId,
            sourceRevision: event.revision,
            updatedAt: Date.now(),
          }
        }
      }
      document.replay = retryEvent && retryEvent.type === 'run_started'
        ? document.replays[getReplaySlotKey(retryEvent.providerId, retryEvent.modelId)] ?? {
            anchorUserMessageId: retryAnchorId,
            branchId: document.activeBranchId,
            contextFingerprint: retryEvent.contextFingerprint,
            fidelity: retryEvent.fidelity,
            freshnessRevision: document.freshness.revision,
            messages: retryEvent.initialMessages,
            modelId: retryEvent.modelId,
            providerId: retryEvent.providerId,
            runId: retryEvent.runId ?? retryEvent.eventId,
            sourceRevision: retryEvent.revision,
            updatedAt: Date.now(),
          }
        : null
      appendEvent(document, {
        fromBranchId: previousBranchId,
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
      initialMessages: encodeModelMessages(input.initialMessages),
      modelId: input.modelId,
      providerId: input.providerId,
      runId: input.runId,
      type: 'run_started',
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
    })
    document.usage = {
      cacheHitSteps: document.usage.cacheHitSteps + (step.usage.cacheReadTokens > 0 ? 1 : 0),
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
    const completedEvent = appendEvent(document, {
      runId: input.runId,
      type: 'run_completed',
    })
    document.replay = {
      anchorUserMessageId: input.anchorUserMessageId,
      branchId: document.activeBranchId,
      contextFingerprint: input.contextFingerprint,
      fidelity: input.fidelity,
      freshnessRevision: input.freshnessRevision,
      messages: encodeModelMessages(input.messages),
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
) {
  return updateDocument(conversationId, (document) => {
    appendEvent(document, { reason, runId, type })
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
      'apply_patch',
      'replace_file_content',
      'multi_replace_file_content',
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
