import type { ModelMessage } from 'ai'
import type { Message } from '../../../src/types/chat'
import { buildModelMessages, type BuildChatPromptOptions } from '../shared/messages'
import {
  sanitizeCompactedModelMessages,
  sanitizeModelMessages,
} from '../shared/modelMessageIntegrity'
import { parseCompactionPacket, type CompactionPacket } from '../shared/compaction/contracts'
import { buildCompactionMessage } from '../shared/compaction/window'
import {
  isCompactionContinuationMessage,
  repairCompactionPacketContinuation,
} from '../shared/compaction/markdown'
import { decodeModelMessages, decodeReplayValue, encodeModelMessages } from './replayCodec'
import {
  getReplaySlotKey,
  type CanonicalHistoryDocument,
  type CanonicalReplayProjection,
} from './contracts'
import { shouldMigrateCrossProviderHistoryToText } from './providerSwitch'
import { migrateToolHistoryToUserInput } from './providerToolMigration'

export interface ReplayProjectionResult {
  compactionPacket: CompactionPacket | null
  fidelity: 'exact' | 'legacy' | 'migrated_legacy'
  freshnessRevision: number
  isCompacted: boolean
  messages: ModelMessage[]
  replayRunId: string | null
}

type CompactionReplayProjection = CanonicalReplayProjection & {
  compactionPacket: CompactionPacket | null
  isCompacted: true
}

function repairReplayCompactionMessages(
  messages: readonly ModelMessage[],
  packet: CompactionPacket | null,
) {
  if (!packet) return [...messages]
  const repairedPacket = repairCompactionPacketContinuation(packet)
  return messages.map((message) => (
    isCompactionContinuationMessage(message, repairedPacket.continuationMarkdown)
      ? buildCompactionMessage(repairedPacket)
      : message
  ))
}

function findLatestCompactionProjection(input: {
  document: CanonicalHistoryDocument
  messages: readonly Message[]
  modelId: string
  providerId: CanonicalReplayProjection['providerId']
}): CompactionReplayProjection | null {
  const compactionEvents = [...input.document.events].reverse().filter((candidate) => (
    candidate.type === 'compaction_committed' &&
    'projectedMessages' in candidate &&
    candidate.branchId === input.document.activeBranchId
  ))
  // A compaction projection is conversation state, not a provider-specific
  // transcript. Reuse the newest active-branch projection when switching
  // providers. Provider-specific tool compatibility is handled separately
  // by shouldMigrateCrossProviderHistoryToText.
  const event = compactionEvents[0]
  if (!event || event.type !== 'compaction_committed' || !('projectedMessages' in event)) {
    return null
  }

  try {
    const decodedPacket = parseCompactionPacket(decodeReplayValue(event.packet))
    if (!decodedPacket) throw new Error('Stored compaction packet is not a v2 packet.')
    const repairedPacket = repairCompactionPacketContinuation(decodedPacket)
    const decodedMessages = decodeModelMessages(event.projectedMessages)
    const repairedMessages = sanitizeCompactedModelMessages(decodedMessages.map((message): ModelMessage => (
      (message.role === 'assistant' && typeof message.content === 'string' && message.content === decodedPacket.continuationMarkdown) ||
      isCompactionContinuationMessage(message, decodedPacket.continuationMarkdown)
        ? buildCompactionMessage(repairedPacket)
        : message
    )))
    return {
      anchorUserMessageId: event.anchorUserMessageId,
      branchId: event.branchId,
      contextFingerprint: input.document.contextFingerprint ?? '',
      fidelity: 'exact' as const,
      freshnessRevision: input.document.freshness.revision,
      isCompacted: true,
      messages: encodeModelMessages(repairedMessages),
      compactionPacket: repairedPacket,
      modelId: input.modelId,
      providerId: input.providerId,
      runId: event.compactionId,
      sourceRevision: event.revision,
      updatedAt: event.createdAt,
    }
  } catch (error) {
    try {
      const decodedPacket = parseCompactionPacket(decodeReplayValue(event.packet))
      const anchorMessage = input.messages.find((message) => message.id === event.anchorUserMessageId)
      if (!decodedPacket || !anchorMessage) throw error
      const repairedPacket = repairCompactionPacketContinuation(decodedPacket)
      const recoveredAnchor = buildModelMessages([anchorMessage], {
        includeExecutionModeContext: false,
      })
      const recoveredMessages = sanitizeModelMessages([
        ...recoveredAnchor,
        buildCompactionMessage(repairedPacket),
      ])
      console.warn('Canonical compaction projection was unavailable; rebuilding it from the stored packet.')
      return {
        anchorUserMessageId: event.anchorUserMessageId,
        branchId: event.branchId,
        contextFingerprint: input.document.contextFingerprint ?? '',
        fidelity: 'migrated_legacy' as const,
        freshnessRevision: input.document.freshness.revision,
        isCompacted: true,
        messages: encodeModelMessages(recoveredMessages),
        compactionPacket: repairedPacket,
        modelId: input.modelId,
        providerId: input.providerId,
        runId: event.compactionId,
        sourceRevision: event.revision,
        updatedAt: event.createdAt,
      }
    } catch {
      // The caller will fall back to the durable display history below.
    }
    console.warn('Canonical compaction projection could not be decoded.', error)
    return null
  }
}

function replayIncludesCompaction(
  document: CanonicalHistoryDocument,
  replay: CanonicalHistoryDocument['replay'],
) {
  if (!replay) return false

  return document.events.some((event) => (
    event.branchId === document.activeBranchId &&
    event.type === 'compaction_committed' &&
    'projectedMessages' in event &&
    event.providerId === replay.providerId &&
    event.modelId === replay.modelId &&
    event.revision <= replay.sourceRevision
  ))
}

function findLatestCompactionPacketForReplay(input: {
  document: CanonicalHistoryDocument
  modelId: string
  providerId: CanonicalReplayProjection['providerId']
  replay: CanonicalReplayProjection
}) {
  const events = [...input.document.events].reverse().filter((event) => (
    event.branchId === input.document.activeBranchId &&
    event.type === 'compaction_committed' &&
    'packet' in event &&
    event.revision <= input.replay.sourceRevision
  ))
  const candidates = [
    ...events.filter((event) => event.type === 'compaction_committed' && 'providerId' in event && 'modelId' in event && event.providerId === input.providerId && event.modelId === input.modelId),
    ...events.filter((event) => event.type === 'compaction_committed' && 'providerId' in event && 'modelId' in event && !(event.providerId === input.providerId && event.modelId === input.modelId)),
  ]
  for (const event of candidates) {
    if (event.type !== 'compaction_committed' || !('packet' in event)) continue
    try {
      const packet = parseCompactionPacket(decodeReplayValue(event.packet))
      if (packet) return repairCompactionPacketContinuation(packet)
    } catch {
      continue
    }
  }
  return null
}

function appendFreshnessNotice(messages: ModelMessage[], invalidatedSubjects: string[]) {
  if (invalidatedSubjects.length === 0) return messages
  const notice = [
    '<context_freshness_notice>',
    'Earlier observations for these subjects may be stale after successful mutations:',
    ...invalidatedSubjects.map((subject) => `- ${subject}`),
    'Re-read or re-run the relevant tool before relying on those observations.',
    '</context_freshness_notice>',
  ].join('\n')

  const next = [...messages]
  const lastUserIndex = next.findLastIndex((message) => message.role === 'user')
  if (lastUserIndex < 0) return [...next, { content: notice, role: 'user' as const }]
  const lastUser = next[lastUserIndex] as Extract<ModelMessage, { role: 'user' }>
  const content = typeof lastUser.content === 'string'
    ? `${lastUser.content}\n\n${notice}`
    : [...lastUser.content, { text: notice, type: 'text' as const }]
  next[lastUserIndex] = { ...lastUser, content }
  return next
}

function buildPostAnchorReplaySuffix(
  messages: Message[],
  anchorIndex: number,
  options?: BuildChatPromptOptions,
) {
  const postAnchorMessages = messages.slice(anchorIndex + 1)
  const firstNewUserIndex = postAnchorMessages.findIndex((message) => message.role === 'user')
  if (firstNewUserIndex < 0) {
    return []
  }

  return buildModelMessages(postAnchorMessages.slice(firstNewUserIndex), {
    ...options,
    includeExecutionModeContext: false,
  })
}

export function projectCanonicalReplay(input: {
  document: CanonicalHistoryDocument
  fallbackMessages: ModelMessage[]
  messages: Message[]
  modelId: string
  options?: BuildChatPromptOptions
  providerId: CanonicalHistoryDocument['replay'] extends infer Replay
    ? Replay extends { providerId: infer ProviderId }
      ? ProviderId
      : never
    : never
}): ReplayProjectionResult {
  const finalizeProjection = (projection: ReplayProjectionResult): ReplayProjectionResult => {
    const shouldMigrateToolHistory = shouldMigrateCrossProviderHistoryToText({
      document: input.document,
      messages: input.messages,
      targetProviderId: input.providerId,
    })
    if (!shouldMigrateToolHistory) return projection

    return {
      ...projection,
      fidelity: 'migrated_legacy',
      messages: migrateToolHistoryToUserInput(projection.messages),
      replayRunId: null,
    }
  }
  const storedReplay = input.document.replays[getReplaySlotKey(input.providerId, input.modelId)] ?? input.document.replay
  const compactionProjection = findLatestCompactionProjection({
    document: input.document,
    messages: input.messages,
    modelId: input.modelId,
    providerId: input.providerId,
  })
  const replay = compactionProjection && (!storedReplay || compactionProjection.sourceRevision > storedReplay.sourceRevision)
    ? compactionProjection
    : storedReplay
  if (
    !replay ||
    replay.branchId !== input.document.activeBranchId ||
    replay.providerId !== input.providerId ||
    replay.modelId !== input.modelId ||
    !replay.anchorUserMessageId
  ) {
    const fidelity = input.messages.some((message) => message.role === 'assistant' || message.role === 'tool')
      ? 'legacy'
      : 'exact'
    return finalizeProjection({
      fidelity,
      freshnessRevision: input.document.freshness.revision,
      isCompacted: false,
      messages: sanitizeModelMessages(input.fallbackMessages),
      replayRunId: null,
      compactionPacket: null,
    })
  }

  const anchorIndex = input.messages.findIndex((message) => message.id === replay.anchorUserMessageId)
  if (anchorIndex < 0) {
    return finalizeProjection({
      fidelity: 'legacy',
      freshnessRevision: input.document.freshness.revision,
      isCompacted: false,
      messages: sanitizeModelMessages(input.fallbackMessages),
      replayRunId: null,
      compactionPacket: null,
    })
  }

  const replayCompactionPacket = compactionProjection?.compactionPacket ?? findLatestCompactionPacketForReplay({
    document: input.document,
    modelId: input.modelId,
    providerId: input.providerId,
    replay,
  })

  try {
    const exactPrefix = sanitizeCompactedModelMessages(repairReplayCompactionMessages(
      decodeModelMessages(replay.messages),
      replayCompactionPacket,
    ) as ModelMessage[])
    const suffix = buildPostAnchorReplaySuffix(input.messages, anchorIndex, input.options)
    const messages = replay.freshnessRevision < input.document.freshness.revision
      ? appendFreshnessNotice([...exactPrefix, ...suffix], input.document.freshness.invalidatedSubjects)
      : [...exactPrefix, ...suffix]
    const replayIsCompacted = compactionProjection?.sourceRevision === replay.sourceRevision || replayIncludesCompaction(
      input.document,
      replay,
    )
    return finalizeProjection({
      fidelity: replay.fidelity,
      freshnessRevision: input.document.freshness.revision,
      isCompacted: replayIsCompacted,
      messages: sanitizeModelMessages(messages),
      replayRunId: replay.runId,
      compactionPacket: replayCompactionPacket,
    })
  } catch (error) {
    console.warn('Canonical replay could not be decoded; using legacy history projection.', error)
    return finalizeProjection({
      fidelity: 'legacy',
      freshnessRevision: input.document.freshness.revision,
      isCompacted: false,
      messages: sanitizeModelMessages(input.fallbackMessages),
      replayRunId: null,
      compactionPacket: null,
    })
  }
}
