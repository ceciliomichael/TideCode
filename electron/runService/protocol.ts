import type {
  AppendConversationMessagesInput,
  ChatCompactionLifecycleState,
  CompactConversationInput,
  ClaimSharedFollowUpsInput,
  ClaimSharedFollowUpsResult,
  CompactConversationResult,
  ConversationFolderRecord,
  ConversationRecord,
  ReplaceConversationMessagesInput,
  SharedConversationRuntimeSnapshot,
  SharedFollowUpSnapshot,
  SharedRunProjection,
  SharedRunSnapshot,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
  TideCodeRunEvent,
  UpdateConversationRuntimeInput,
  UpdateSharedFollowUpsInput,
  UpdatePendingSteerMessagesInput,
  UpdatePendingSteerMessagesResult,
} from '../../src/types/chat'

export const RUN_SERVICE_PROTOCOL_VERSION = 11

export type RunServiceRequest =
  | { id: string; token: string; method: 'hello'; params?: undefined }
  | { id: string; token: string; method: 'getCompactionState'; params: { conversationId: string } }
  | { id: string; token: string; method: 'getConversationRuntime'; params: { conversationId: string } }
  | { id: string; token: string; method: 'getPendingFollowUps'; params: { streamId: string } }
  | { id: string; token: string; method: 'getRunProjection'; params: { runId: string } }
  | { id: string; token: string; method: 'listActiveRuns'; params?: undefined }
  | { id: string; token: string; method: 'ensureWorkspaceProject'; params: { workspacePath: string } }
  | { id: string; token: string; method: 'appendMessages'; params: AppendConversationMessagesInput }
  | { id: string; token: string; method: 'replaceMessages'; params: ReplaceConversationMessagesInput }
  | { id: string; token: string; method: 'compactConversation'; params: CompactConversationInput }
  | { id: string; token: string; method: 'startStream'; params: StartChatStreamInput }
  | { id: string; token: string; method: 'cancelStream'; params: { streamId: string } }
  | { id: string; token: string; method: 'updatePendingSteerMessages'; params: UpdatePendingSteerMessagesInput }
  | { id: string; token: string; method: 'updatePendingFollowUps'; params: UpdateSharedFollowUpsInput }
  | { id: string; token: string; method: 'claimPendingFollowUps'; params: ClaimSharedFollowUpsInput }
  | { id: string; token: string; method: 'submitToolDecision'; params: SubmitToolDecisionInput }
  | { id: string; token: string; method: 'updateConversationRuntime'; params: UpdateConversationRuntimeInput }

export type RunServiceResponseResult =
  | { protocolVersion: number }
  | ChatCompactionLifecycleState
  | ClaimSharedFollowUpsResult
  | CompactConversationResult
  | ConversationFolderRecord
  | ConversationRecord
  | SharedConversationRuntimeSnapshot
  | SharedFollowUpSnapshot
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
