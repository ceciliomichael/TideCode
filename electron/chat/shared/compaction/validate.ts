import { localCompactionPacketSchema, type LocalCompactionPacket } from './contracts'
import { sanitizeCompactionPacket } from './sanitize'

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
  | 'nextActions'
  | 'omitted'
  | 'filesAndSymbols'
  | 'toolObservations'

function clipText(value: string) {
  const normalized = value.trim()
  return normalized.length <= MAX_PROJECTED_PACKET_TEXT_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_PROJECTED_PACKET_TEXT_CHARS - 1).trimEnd()}…`
}

function boundTextList(values: string[]) {
  return values.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map(clipText)
}

function boundPacket(packet: LocalCompactionPacket) {
  const bounded: LocalCompactionPacket = {
    ...packet,
    constraints: boundTextList(packet.constraints),
    currentState: boundTextList(packet.currentState),
    completedWork: boundTextList(packet.completedWork),
    decisions: boundTextList(packet.decisions),
    openItems: boundTextList(packet.openItems),
    failuresAndWorkarounds: boundTextList(packet.failuresAndWorkarounds),
    goal: boundTextList(packet.goal),
    filesAndSymbols: packet.filesAndSymbols.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map((file) => ({
      ...file,
      evidence: clipText(file.evidence),
      path: clipText(file.path),
      symbols: file.symbols.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map(clipText),
    })),
    validation: boundTextList(packet.validation),
    planState: boundTextList(packet.planState),
    toolObservations: packet.toolObservations.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS).map((observation) => ({
      ...observation,
      fact: clipText(observation.fact),
      sourceMessageIds: observation.sourceMessageIds.slice(0, MAX_PROJECTED_PACKET_LIST_ITEMS),
      subject: clipText(observation.subject),
    })),
    nextActions: boundTextList(packet.nextActions),
    omitted: boundTextList(packet.omitted),
  }

  const dropOrder: PacketListKey[] = [
    'omitted',
    'toolObservations',
    'filesAndSymbols',
    'validation',
    'planState',
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

export function parseCompactionModelOutput(value: string, expected: {
  sourceDigest: string
  sourceMessageIds: string[]
}) {
  try {
    const parsed = JSON.parse(extractJsonCandidate(value)) as unknown
    const result = localCompactionPacketSchema.safeParse(parsed)
    if (!result.success) return null
    if (result.data.sourceDigest !== expected.sourceDigest) return null
    if (!expected.sourceMessageIds.every((id) => result.data.sourceMessageIds.includes(id))) return null
    return result.data
  } catch {
    return null
  }
}

export function normalizeCompactionPacket(packet: LocalCompactionPacket, expected: {
  sourceDigest: string
  sourceMessageIds: string[]
}) {
  const sourceIds = new Set(expected.sourceMessageIds)
  const normalized = boundPacket(sanitizeCompactionPacket({
    ...packet,
    sourceDigest: expected.sourceDigest,
    sourceMessageIds: packet.sourceMessageIds.filter((id) => sourceIds.has(id)),
  }))
  const result = localCompactionPacketSchema.safeParse(normalized)
  return result.success ? result.data : null
}
