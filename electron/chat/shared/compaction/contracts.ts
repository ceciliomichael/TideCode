import type { ModelMessage } from 'ai'
import { z } from 'zod'

export const LOCAL_COMPACTION_PACKET_SCHEMA = 'tidecode.compaction_packet/v1' as const

const boundedText = z.string().trim().max(4_000)
const boundedTextList = z.array(boundedText).max(64)

const fileStateSchema = z.object({
  path: z.string().trim().min(1).max(1_000),
  symbols: z.array(z.string().trim().max(500)).max(32),
  status: z.enum(['read', 'created', 'modified', 'deleted', 'unknown']),
  evidence: boundedText,
}).strict()

const toolObservationSchema = z.object({
  subject: z.string().trim().min(1).max(1_000),
  fact: boundedText,
  status: z.enum(['current', 'stale', 'unknown']),
  sourceMessageIds: z.array(z.string().trim().min(1).max(200)).max(32),
}).strict()

export const localCompactionPacketSchema = z.object({
  schema: z.literal(LOCAL_COMPACTION_PACKET_SCHEMA),
  packetId: z.string().trim().min(1).max(128),
  sourceDigest: z.string().trim().min(1).max(128),
  sourceMessageIds: z.array(z.string().trim().min(1).max(200)).max(512),
  goal: boundedTextList,
  constraints: boundedTextList,
  currentState: boundedTextList,
  completedWork: boundedTextList,
  decisions: boundedTextList,
  openItems: boundedTextList,
  failuresAndWorkarounds: boundedTextList,
  filesAndSymbols: z.array(fileStateSchema).max(96),
  validation: boundedTextList,
  planState: boundedTextList,
  toolObservations: z.array(toolObservationSchema).max(96),
  nextActions: boundedTextList,
  omitted: boundedTextList,
}).strict()

export type LocalCompactionPacket = z.infer<typeof localCompactionPacketSchema>

export type CompactionReasoningMode =
  | 'replayable_reasoning'
  | 'summarizable_reasoning'
  | 'unavailable_reasoning'

export interface CompactionWindow {
  anchorMessages: ModelMessage[]
  boundaryIndex: number
  evictedMessages: ModelMessage[]
  sourceMessageIds: string[]
  tailMessages: ModelMessage[]
}

export interface CompactionResult {
  boundaryIndex: number
  packet: LocalCompactionPacket
  projectedMessages: ModelMessage[]
  sourceDigest: string
  usedFallback: boolean
}

export interface CompactionStreamInput {
  messages: ModelMessage[]
  model: string
  reasoningEffort: string
  signal: AbortSignal
  system: string
}

export type CompactionStreamFactory = (
  input: CompactionStreamInput,
) => Promise<{
  fullStream: AsyncIterable<{ text?: string; type: string }>
}>

export interface CompactModelMessagesInput {
  createStream?: CompactionStreamFactory
  force?: boolean
  messages: ModelMessage[]
  model: string
  reasoningEffort: string
  systemPromptTokens: number
  toolSchemaTokens: number
  contextWindowTokens?: number
  triggerRatio?: number
  reserveTokens?: number
  previousPacket?: LocalCompactionPacket | null
  signal?: AbortSignal
}

export function parseLocalCompactionPacket(value: unknown) {
  const result = localCompactionPacketSchema.safeParse(value)
  return result.success ? result.data : null
}
