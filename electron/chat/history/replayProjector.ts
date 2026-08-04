import type { ModelMessage } from 'ai'
import type { Message } from '../../../src/types/chat'
import { buildModelMessages, type BuildChatPromptOptions } from '../shared/messages'
import { sanitizeModelMessages } from '../shared/modelMessageIntegrity'
import { decodeModelMessages } from './replayCodec'
import {
  getReplaySlotKey,
  type CanonicalHistoryDocument,
  type CanonicalReplayProjection,
} from './contracts'

export interface ReplayProjectionResult {
  fidelity: 'exact' | 'legacy' | 'migrated_legacy'
  freshnessRevision: number
  isCompacted: boolean
  messages: ModelMessage[]
  replayRunId: string | null
}

type CompactionReplayProjection = CanonicalReplayProjection & {
  isCompacted: true
}

function findLatestCompactionProjection(input: {
  document: CanonicalHistoryDocument
  modelId: string
  providerId: CanonicalReplayProjection['providerId']
}): CompactionReplayProjection | null {
  const compactionEvents = [...input.document.events].reverse().filter((candidate) => (
    candidate.type === 'compaction_committed' &&
    'projectedMessages' in candidate &&
    candidate.branchId === input.document.activeBranchId
  ))
  const event = compactionEvents.find((candidate) => (
    candidate.type === 'compaction_committed' &&
    'projectedMessages' in candidate &&
    candidate.modelId === input.modelId &&
    candidate.providerId === input.providerId
  )) ?? compactionEvents.find((candidate) => (
    candidate.type === 'compaction_committed' &&
    'projectedMessages' in candidate &&
    candidate.providerId === input.providerId
  ))
  if (!event || event.type !== 'compaction_committed' || !('projectedMessages' in event)) {
    return null
  }

  try {
    decodeModelMessages(event.projectedMessages)
    return {
      anchorUserMessageId: event.anchorUserMessageId,
      branchId: event.branchId,
      contextFingerprint: input.document.contextFingerprint ?? '',
      fidelity: 'exact' as const,
      freshnessRevision: input.document.freshness.revision,
      isCompacted: true,
      messages: event.projectedMessages,
      modelId: input.modelId,
      providerId: input.providerId,
      runId: event.compactionId,
      sourceRevision: event.revision,
      updatedAt: event.createdAt,
    }
  } catch (error) {
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
  const storedReplay = input.document.replays[getReplaySlotKey(input.providerId, input.modelId)] ?? input.document.replay
  const compactionProjection = findLatestCompactionProjection({
    document: input.document,
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
    return {
      fidelity,
      freshnessRevision: input.document.freshness.revision,
      isCompacted: false,
      messages: sanitizeModelMessages(input.fallbackMessages),
      replayRunId: null,
    }
  }

  const anchorIndex = input.messages.findIndex((message) => message.id === replay.anchorUserMessageId)
  if (anchorIndex < 0) {
    return {
      fidelity: 'legacy',
      freshnessRevision: input.document.freshness.revision,
      isCompacted: false,
      messages: sanitizeModelMessages(input.fallbackMessages),
      replayRunId: null,
    }
  }

  try {
    const exactPrefix = sanitizeModelMessages(decodeModelMessages(replay.messages))
    const suffix = buildPostAnchorReplaySuffix(input.messages, anchorIndex, input.options)
    const messages = replay.freshnessRevision < input.document.freshness.revision
      ? appendFreshnessNotice([...exactPrefix, ...suffix], input.document.freshness.invalidatedSubjects)
      : [...exactPrefix, ...suffix]
    return {
      fidelity: replay.fidelity,
      freshnessRevision: input.document.freshness.revision,
      isCompacted: replayIncludesCompaction(input.document, replay),
      messages: sanitizeModelMessages(messages),
      replayRunId: replay.runId,
    }
  } catch (error) {
    console.warn('Canonical replay could not be decoded; using legacy history projection.', error)
    return {
      fidelity: 'legacy',
      freshnessRevision: input.document.freshness.revision,
      isCompacted: false,
      messages: sanitizeModelMessages(input.fallbackMessages),
      replayRunId: null,
    }
  }
}
