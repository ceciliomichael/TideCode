import type { ChatProviderId } from '../../../src/types/chat'

export const CANONICAL_HISTORY_SCHEMA = 'echosphere.canonical_history/v1' as const
export const REPLAY_CODEC_SCHEMA = 'echosphere.replay_value/v1' as const

export type ReplayScalar = boolean | null | number | string

export type EncodedReplayValue =
  | ReplayScalar
  | EncodedReplayValue[]
  | { [key: string]: EncodedReplayValue }

export interface NormalizedUsageRecord {
  cacheReadTokens: number
  cacheWriteTokens: number
  inputTokens: number
  noCacheTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

export interface CanonicalUsageSummary extends NormalizedUsageRecord {
  cacheHitSteps: number
  stepCount: number
  totalDurationMs: number
}

export interface CanonicalPromptContext {
  fingerprint: string
  modelHash: string
  systemHash: string
  toolSchemaTokens: number
  toolsHash: string
}

interface CanonicalHistoryEventBase {
  branchId: string
  createdAt: number
  eventId: string
  revision: number
  runId: string | null
}

export type CanonicalHistoryEvent =
  | (CanonicalHistoryEventBase & {
      messageIds: string[]
      type: 'messages_synchronized'
    })
  | (CanonicalHistoryEventBase & {
      fromBranchId: string
      reason: 'edited' | 'reverted' | 'history_replaced' | 'replay_anchor_missing'
      type: 'branch_created'
    })
  | (CanonicalHistoryEventBase & {
      contextFingerprint: string
      changeReasons: Array<'model' | 'system' | 'tools'>
      previousContextFingerprint: string | null
      promptContext: CanonicalPromptContext
      type: 'context_epoch_changed'
    })
  | (CanonicalHistoryEventBase & {
      anchorUserMessageId: string | null
      contextFingerprint: string
      fidelity: CanonicalReplayProjection['fidelity']
      initialMessages: EncodedReplayValue
      modelId: string
      providerId: ChatProviderId
      type: 'run_started'
    })
  | (CanonicalHistoryEventBase & {
      finishReason: string
      providerMetadata: EncodedReplayValue | null
      responseMessages: EncodedReplayValue
      stepNumber: number
      durationMs: number
      type: 'step_completed'
      usage: NormalizedUsageRecord
    })
  | (CanonicalHistoryEventBase & {
      type: 'run_completed'
    })
  | (CanonicalHistoryEventBase & {
      reason: string
      type: 'run_aborted' | 'run_failed'
    })
  | (CanonicalHistoryEventBase & {
      subject: string
      toolName: string
      type: 'observation_recorded' | 'observation_invalidated'
    })
  | (CanonicalHistoryEventBase & {
      summary: string
      type: 'compaction_committed'
    })

export interface CanonicalReplayProjection {
  anchorUserMessageId: string | null
  branchId: string
  contextFingerprint: string
  fidelity: 'exact' | 'migrated_legacy'
  freshnessRevision: number
  messages: EncodedReplayValue
  modelId: string
  providerId: ChatProviderId
  runId: string
  sourceRevision: number
  updatedAt: number
}

export interface CanonicalFreshnessState {
  invalidatedSubjects: string[]
  revision: number
}

export interface CanonicalHistoryDocument {
  activeBranchId: string
  contextFingerprint: string | null
  promptContext: CanonicalPromptContext | null
  conversationId: string
  createdAt: number
  events: CanonicalHistoryEvent[]
  freshness: CanonicalFreshnessState
  replay: CanonicalReplayProjection | null
  replays: Record<string, CanonicalReplayProjection>
  revision: number
  schema: typeof CANONICAL_HISTORY_SCHEMA
  synchronizedMessageDigests: string[]
  synchronizedMessageIds: string[]
  updatedAt: number
  usage: CanonicalUsageSummary
}

export interface ProviderStepRecord {
  finishReason: string
  providerMetadata: unknown
  responseMessages: unknown[]
  stepNumber: number
  durationMs: number
  usage: NormalizedUsageRecord
}

export function createEmptyCanonicalHistory(conversationId: string, createdAt = Date.now()): CanonicalHistoryDocument {
  return {
    activeBranchId: 'main',
    contextFingerprint: null,
    promptContext: null,
    conversationId,
    createdAt,
    events: [],
    freshness: {
      invalidatedSubjects: [],
      revision: 0,
    },
    replay: null,
    replays: {},
    revision: 0,
    schema: CANONICAL_HISTORY_SCHEMA,
    synchronizedMessageDigests: [],
    synchronizedMessageIds: [],
    updatedAt: createdAt,
    usage: {
      cacheHitSteps: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 0,
      noCacheTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      stepCount: 0,
      totalDurationMs: 0,
      totalTokens: 0,
    },
  }
}

export function getReplaySlotKey(providerId: ChatProviderId, modelId: string) {
  return JSON.stringify([providerId, modelId])
}
