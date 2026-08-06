import {
  localCompactionPacketV2Schema,
  type CompactionPacket,
  type LocalCompactionPacketV2,
} from './contracts'
import { validateContinuationMarkdown } from './markdown'
import { sanitizeCompactionPacketV2 } from './sanitize'

const MAX_PROJECTED_PACKET_CHARS = 48_000
const MAX_PROJECTED_PACKET_TEXT_CHARS = 800
const MAX_PROJECTED_PACKET_LIST_ITEMS = 24

type PacketListKey =
  | 'goal'
  | 'constraints'
  | 'currentState'
  | 'completedWork'
  | 'decisions'
  | 'openItems'
  | 'failuresAndWorkarounds'
  | 'validation'
  | 'planState'
  | 'filesAndSymbols'
  | 'toolObservations'
  | 'nextActions'
  | 'omitted'

function clipText(value: string) {
  const normalized = value.trim()
  return normalized.length <= MAX_PROJECTED_PACKET_TEXT_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_PROJECTED_PACKET_TEXT_CHARS - 1).trimEnd()}…`
}

function boundTextList(values: readonly string[]) {
  return values.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map(clipText)
}

function boundPacket(packet: LocalCompactionPacketV2): LocalCompactionPacketV2 {
  const bounded: LocalCompactionPacketV2 = {
    ...packet,
    continuationMarkdown: packet.continuationMarkdown.slice(0, 32_000),
    constraints: boundTextList(packet.constraints),
    currentState: boundTextList(packet.currentState),
    completedWork: boundTextList(packet.completedWork),
    decisions: boundTextList(packet.decisions),
    failuresAndWorkarounds: boundTextList(packet.failuresAndWorkarounds),
    filesAndSymbols: packet.filesAndSymbols.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map((file) => ({
      ...file,
      evidence: clipText(file.evidence),
      path: clipText(file.path),
      symbols: file.symbols.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map(clipText),
    })),
    goal: boundTextList(packet.goal),
    nextActions: boundTextList(packet.nextActions),
    omitted: boundTextList(packet.omitted),
    openItems: boundTextList(packet.openItems),
    planState: boundTextList(packet.planState),
    reasoningContinuity: packet.reasoningContinuity.slice(0, 16).map((entry) => ({
      ...entry,
      action: clipText(entry.action),
      evidence: entry.evidence.slice(0, 8).map(clipText),
      nextCheck: entry.nextCheck === null ? null : clipText(entry.nextCheck),
      rationale: clipText(entry.rationale),
      situation: clipText(entry.situation),
      sourceMessageIds: entry.sourceMessageIds.slice(0, 16),
    })),
    sourceMessageIds: packet.sourceMessageIds.slice(0, 512),
    toolObservations: packet.toolObservations.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map((observation) => ({
      ...observation,
      fact: clipText(observation.fact),
      sourceMessageIds: observation.sourceMessageIds.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS),
      subject: clipText(observation.subject),
    })),
    validation: boundTextList(packet.validation),
  }

  const dropOrder: PacketListKey[] = [
    'omitted',
    'planState',
    'toolObservations',
    'filesAndSymbols',
    'validation',
    'failuresAndWorkarounds',
    'decisions',
    'completedWork',
    'currentState',
    'openItems',
    'constraints',
    'goal',
    'nextActions',
  ]

  while (JSON.stringify(bounded).length > MAX_PROJECTED_PACKET_CHARS) {
    const key = dropOrder.find((candidate) => bounded[candidate].length > 1)
    if (!key) break
    bounded[key] = bounded[key].slice(0, -1) as never
  }

  return bounded
}

function stripReasoningMarkup(value: string) {
  return value
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/giu, '')
    .replace(/<analysis\b[^>]*>[\s\S]*?(?:<\/analysis\s*>|$)/giu, '')
    .replace(/<reasoning\b[^>]*>[\s\S]*?(?:<\/reasoning\s*>|$)/giu, '')
    .trim()
}

function extractJsonCandidate(value: string) {
  const withoutReasoning = stripReasoningMarkup(value)
  const withoutFence = withoutReasoning.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  return start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence
}

function isExpectedSourceRange(value: unknown): value is { startIndex: number; endIndex: number } {
  return typeof value === 'object' && value !== null &&
    'startIndex' in value && typeof value.startIndex === 'number' &&
    'endIndex' in value && typeof value.endIndex === 'number'
}

function verifySourceCoverage(packet: LocalCompactionPacketV2, expectedSourceMessageIds: readonly string[]) {
  return expectedSourceMessageIds.every((id) => packet.sourceMessageIds.includes(id))
}

function normalizeReasoningSources(
  entries: readonly LocalCompactionPacketV2['reasoningContinuity'][number][],
  sourceMessageIds: readonly string[],
) {
  const sourceIdSet = new Set(sourceMessageIds)
  const fallbackSourceId = sourceMessageIds[0] ?? 'model:0'
  return entries.map((entry) => ({
    ...entry,
    sourceMessageIds: entry.sourceMessageIds.filter((id) => sourceIdSet.has(id)).length > 0
      ? entry.sourceMessageIds.filter((id) => sourceIdSet.has(id))
      : [fallbackSourceId],
  }))
}

export function parseCompactionModelOutput(value: string, expected: {
  modelId?: string
  parentPacketId?: string | null
  providerId?: string
  reasoningMode?: LocalCompactionPacketV2['reasoningRetention']['mode']
  sourceDigest: string
  sourceMessageIds: string[]
  sourceRange?: { startIndex: number; endIndex: number }
}) : CompactionPacket | null {
  try {
    const parsed = JSON.parse(extractJsonCandidate(value)) as unknown
    const v2Result = localCompactionPacketV2Schema.safeParse(parsed)
    if (v2Result.success) {
      if (v2Result.data.sourceDigest !== expected.sourceDigest || !verifySourceCoverage(v2Result.data, expected.sourceMessageIds)) {
        return null
      }
      return v2Result.data
    }
    return null
  } catch {
    return null
  }
}

export function normalizeCompactionPacket(packet: CompactionPacket, expected: {
  modelId?: string
  parentPacketId?: string | null
  providerId?: string
  reasoningMode?: LocalCompactionPacketV2['reasoningRetention']['mode']
  sourceDigest: string
  sourceMessageIds: string[]
  sourceRange?: { startIndex: number; endIndex: number }
}) : LocalCompactionPacketV2 | null {
  const candidate = packet
  const sourceIds = new Set(expected.sourceMessageIds)
  const normalizedMarkdown = validateContinuationMarkdown(candidate.continuationMarkdown)
  if (!normalizedMarkdown.valid) return null

  const normalized = boundPacket(sanitizeCompactionPacketV2({
    ...candidate,
    continuationMarkdown: normalizedMarkdown.normalized,
    parentPacketId: expected.parentPacketId ?? candidate.parentPacketId ?? null,
    reasoningContinuity: normalizeReasoningSources(candidate.reasoningContinuity, expected.sourceMessageIds),
    reasoningRetention: {
      ...candidate.reasoningRetention,
      mode: expected.reasoningMode ?? candidate.reasoningRetention.mode,
      modelId: expected.modelId?.trim() || candidate.reasoningRetention.modelId,
      providerId: expected.providerId?.trim() || candidate.reasoningRetention.providerId,
    },
    schema: 'tidecode.compaction_packet/v2',
    sourceDigest: expected.sourceDigest,
    sourceMessageIds: expected.sourceMessageIds.filter((id) => sourceIds.has(id)),
    ...(expected.sourceRange ? { sourceRange: expected.sourceRange } : {}),
  }))
  const result = localCompactionPacketV2Schema.safeParse(normalized)
  if (!result.success) return null
  return result.data
}

export function isValidCompactionPacketV2(value: unknown): value is LocalCompactionPacketV2 {
  return localCompactionPacketV2Schema.safeParse(value).success
}

export function isStoredCompactionSourceRange(value: unknown) {
  return isExpectedSourceRange(value)
}
