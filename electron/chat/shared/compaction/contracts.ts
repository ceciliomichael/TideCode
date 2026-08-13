import type { ModelMessage } from 'ai'
import type { ChatProviderId } from '../../../../src/types/chat'
import { z } from 'zod'

export const LOCAL_COMPACTION_PACKET_V2_SCHEMA = 'tidecode.compaction_packet/v2' as const
export const COMPACTION_PROJECTION_VERSION = 'tidecode.compaction_projection/v2' as const
export const COMPACTION_MAX_OUTPUT_TOKENS = 8192

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

const reasoningRetentionSchema = z.object({
  mode: z.enum([
    'replayed_exact',
    'replayed_provider_native',
    'summarized_visible',
    'unavailable',
  ]),
  providerId: z.string().trim().min(1).max(128),
  modelId: z.string().trim().min(1).max(512),
  note: boundedText,
}).strict()

const reasoningContinuitySchema = z.object({
  id: z.string().trim().min(1).max(128),
  situation: boundedText,
  action: boundedText,
  rationale: boundedText,
  evidence: z.array(boundedText).max(16),
  outcome: z.enum(['confirmed', 'rejected', 'inconclusive', 'pending', 'superseded']),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  nextCheck: boundedText.nullable(),
  sourceMessageIds: z.array(z.string().trim().min(1).max(200)).max(32),
}).strict()

const sourceRangeSchema = z.object({
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(1),
}).strict()

export const localCompactionPacketV2Schema = z.object({
  schema: z.literal(LOCAL_COMPACTION_PACKET_V2_SCHEMA),
  packetId: z.string().trim().min(1).max(128),
  parentPacketId: z.string().trim().max(128).nullable(),
  sourceDigest: z.string().trim().min(1).max(128),
  sourceMessageIds: z.array(z.string().trim().min(1).max(200)).max(512),
  continuationMarkdown: z.string().trim().min(1).max(32_000),
  reasoningRetention: reasoningRetentionSchema,
  reasoningContinuity: z.array(reasoningContinuitySchema).max(32),
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
  sourceRange: sourceRangeSchema.optional(),
}).strict()

export type LocalCompactionPacketV2 = z.infer<typeof localCompactionPacketV2Schema>
export type CompactionPacket = LocalCompactionPacketV2

export type ReasoningRetentionMode = LocalCompactionPacketV2['reasoningRetention']['mode']

export type CompactionReasoningMode =
  | 'replayable_reasoning'
  | 'summarizable_reasoning'
  | 'unavailable_reasoning'

export interface CompactionWindow {
  anchorMessages: ModelMessage[]
  boundaryIndex: number
  evictedMessages: ModelMessage[]
  sourceStartIndex: number
  sourceEndIndex: number
  sourceMessageIds: string[]
  tailMessages: ModelMessage[]
}

export interface CompactionResult {
  boundaryIndex: number
  packet: LocalCompactionPacketV2
  projectedMessages: ModelMessage[]
  sourceDigest: string
  projectionVersion: typeof COMPACTION_PROJECTION_VERSION
  reasoningRetention: LocalCompactionPacketV2['reasoningRetention']
}

export interface CompactionStreamInput {
  cacheKey?: string
  messages: ModelMessage[]
  maxOutputTokens?: number
  model: string
  providerId?: ChatProviderId
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
  providerId?: ChatProviderId
  reasoningCapability?: {
    mode: 'exact' | 'provider_native' | 'visible' | 'none'
    note: string
  }
  onStarted?: () => void
  reasoningEffort: string
  systemPromptTokens: number
  toolSchemaTokens: number
  contextWindowTokens?: number
  retainedTurnCount?: number
  triggerRatio?: number
  previousPacket?: CompactionPacket | null
  signal?: AbortSignal
}

export function parseCompactionPacket(value: unknown) {
  const result = localCompactionPacketV2Schema.safeParse(value)
  return result.success ? result.data : null
}
