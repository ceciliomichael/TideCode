import {
  CANONICAL_HISTORY_SCHEMA,
  createEmptyCanonicalHistory,
  getReplaySlotKey,
  type CanonicalHistoryDocument,
  type CanonicalHistoryEvent,
  type CanonicalPromptContext,
  type CanonicalReplayProjection,
  type CanonicalUsageSummary,
  type EncodedReplayValue,
  type NormalizedUsageRecord,
} from './contracts'
import { decodeReplayValue } from './replayCodec'
import { parseCompactionPacket } from '../shared/compaction/contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUsageSummary(value: unknown): value is CanonicalUsageSummary {
  return isUsage(value) && isRecord(value) &&
    typeof value.cacheHitSteps === 'number' &&
    typeof value.stepCount === 'number' &&
    typeof value.totalDurationMs === 'number'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isPromptContext(value: unknown): value is CanonicalPromptContext | null {
  if (value === null) return true
  return isRecord(value) &&
    typeof value.fingerprint === 'string' &&
    typeof value.modelHash === 'string' &&
    typeof value.systemHash === 'string' &&
    typeof value.toolSchemaTokens === 'number' &&
    typeof value.toolsHash === 'string'
}

function isUsage(value: unknown): value is NormalizedUsageRecord {
  if (!isRecord(value)) return false
  return ['cacheReadTokens', 'cacheWriteTokens', 'inputTokens', 'noCacheTokens', 'outputTokens', 'reasoningTokens', 'totalTokens']
    .every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
}

function isReasoningRetention(value: unknown) {
  if (!isRecord(value)) return false
  return (
    typeof value.modelId === 'string' &&
    typeof value.note === 'string' &&
    typeof value.providerId === 'string' &&
    ['replayed_exact', 'replayed_provider_native', 'summarized_visible', 'unavailable'].includes(String(value.mode))
  )
}

function isStoredCompactionPacket(value: unknown) {
  try {
    return parseCompactionPacket(decodeReplayValue(value as EncodedReplayValue)) !== null
  } catch {
    return false
  }
}

function isEvent(value: unknown): value is CanonicalHistoryEvent {
  if (!isRecord(value)) return false
  if (
    typeof value.branchId !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.eventId !== 'string' ||
    typeof value.revision !== 'number' ||
    !(value.runId === null || typeof value.runId === 'string') ||
    typeof value.type !== 'string'
  ) return false

  if (value.type === 'step_completed') {
    return typeof value.stepNumber === 'number' && typeof value.durationMs === 'number' && isUsage(value.usage)
  }

  if (value.type === 'compaction_committed' && 'compactionId' in value) {
    return (
      typeof value.anchorUserMessageId === 'string' || value.anchorUserMessageId === null
    ) &&
      typeof value.compactionId === 'string' &&
      typeof value.modelId === 'string' &&
      'packet' in value &&
      'projectedMessages' in value &&
      typeof value.providerId === 'string' &&
      typeof value.sourceDigest === 'string' &&
      isStringArray(value.sourceMessageIds) &&
      typeof value.usedFallback === 'boolean' &&
      (value.compactionSequence === undefined || (typeof value.compactionSequence === 'number' && Number.isInteger(value.compactionSequence))) &&
      (value.contextFingerprint === undefined || value.contextFingerprint === null || typeof value.contextFingerprint === 'string') &&
      (value.parentPacketId === undefined || value.parentPacketId === null || typeof value.parentPacketId === 'string') &&
      (value.projectionVersion === undefined || typeof value.projectionVersion === 'string') &&
      (value.degradedDiagnostics === undefined || isStringArray(value.degradedDiagnostics)) &&
      (value.reasoningRetention === undefined || isReasoningRetention(value.reasoningRetention)) &&
      isStoredCompactionPacket(value.packet)
  }

  return [
    'messages_synchronized', 'branch_created', 'context_epoch_changed', 'run_started', 'run_completed',
    'run_aborted', 'run_failed', 'observation_recorded', 'observation_invalidated', 'compaction_committed',
  ].includes(value.type)
}

function isReplay(value: unknown): value is CanonicalReplayProjection | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  return (
    (value.anchorUserMessageId === null || typeof value.anchorUserMessageId === 'string') &&
    typeof value.branchId === 'string' &&
    typeof value.contextFingerprint === 'string' &&
    (value.fidelity === 'exact' || value.fidelity === 'migrated_legacy') &&
    typeof value.freshnessRevision === 'number' &&
    typeof value.modelId === 'string' &&
    typeof value.providerId === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.sourceRevision === 'number' &&
    typeof value.updatedAt === 'number' &&
    'messages' in value
  )
}

function isReplayMap(value: unknown): value is Record<string, CanonicalReplayProjection> {
  return isRecord(value) && Object.values(value).every((replay) => isReplay(replay) && replay !== null)
}

export function parseCanonicalHistoryDocument(raw: string, expectedConversationId: string): CanonicalHistoryDocument {
  const value = JSON.parse(raw) as unknown
  if (!isRecord(value) || value.schema !== CANONICAL_HISTORY_SCHEMA) {
    throw new Error('Unsupported canonical history schema.')
  }

  if (value.conversationId !== expectedConversationId) {
    throw new Error('Canonical history belongs to a different conversation.')
  }

  if (value.replays === undefined && isReplay(value.replay)) {
    value.replays = value.replay
      ? { [getReplaySlotKey(value.replay.providerId, value.replay.modelId)]: value.replay }
      : {}
  }
  if (value.promptContext === undefined) value.promptContext = null

  if (
    typeof value.activeBranchId !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.revision !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !(value.contextFingerprint === null || typeof value.contextFingerprint === 'string') ||
    !isPromptContext(value.promptContext) ||
    !Array.isArray(value.events) ||
    !value.events.every(isEvent) ||
    !isReplay(value.replay) ||
    !isReplayMap(value.replays) ||
    !isStringArray(value.synchronizedMessageDigests) ||
    !isStringArray(value.synchronizedMessageIds) ||
    !isUsageSummary(value.usage) ||
    !isRecord(value.freshness) ||
    typeof value.freshness.revision !== 'number' ||
    !isStringArray(value.freshness.invalidatedSubjects)
  ) {
    throw new Error('Canonical history document is invalid.')
  }

  return value as unknown as CanonicalHistoryDocument
}

export function normalizeCanonicalHistoryDocument(
  value: CanonicalHistoryDocument | null,
  conversationId: string,
) {
  return value ?? createEmptyCanonicalHistory(conversationId)
}
