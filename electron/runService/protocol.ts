import type {
  AppendConversationMessagesInput,
  ConversationRecord,
  ReplaceConversationMessagesInput,
  SharedRunProjection,
  SharedRunSnapshot,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
  TideCodeRunEvent,
  UpdatePendingSteerMessagesInput,
  UpdatePendingSteerMessagesResult,
} from '../../src/types/chat'

export const RUN_SERVICE_PROTOCOL_VERSION = 4

export type RunServiceRequest =
  | { id: string; token: string; method: 'hello'; params?: undefined }
  | { id: string; token: string; method: 'getRunProjection'; params: { runId: string } }
  | { id: string; token: string; method: 'listActiveRuns'; params?: undefined }
  | { id: string; token: string; method: 'appendMessages'; params: AppendConversationMessagesInput }
  | { id: string; token: string; method: 'replaceMessages'; params: ReplaceConversationMessagesInput }
  | { id: string; token: string; method: 'startStream'; params: StartChatStreamInput }
  | { id: string; token: string; method: 'cancelStream'; params: { streamId: string } }
  | { id: string; token: string; method: 'updatePendingSteerMessages'; params: UpdatePendingSteerMessagesInput }
  | { id: string; token: string; method: 'submitToolDecision'; params: SubmitToolDecisionInput }

export type RunServiceResponseResult =
  | { protocolVersion: number }
  | ConversationRecord
  | SharedRunProjection
  | SharedRunSnapshot[]
  | StartChatStreamResult
  | UpdatePendingSteerMessagesResult
  | SubmitToolDecisionResult
  | null

export interface RunServiceResponse {
  id: string
  ok: boolean
  result?: RunServiceResponseResult
  error?: string
}

export interface RunServiceEventEnvelope {
  type: 'event'
  event: TideCodeRunEvent
}

export type RunServiceWireMessage = RunServiceResponse | RunServiceEventEnvelope

export function isRunServiceRequest(value: unknown): value is RunServiceRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.token === 'string'
    && typeof candidate.method === 'string'
}
