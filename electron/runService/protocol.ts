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
  AppSettingsSurface,
  UpdateSharedFollowUpsInput,
  UpdatePendingSteerMessagesInput,
  UpdatePendingSteerMessagesResult,
  TerminalBrokerAttachInput,
  TerminalBrokerAttachResult,
  TerminalBrokerCreateSessionInput,
  TerminalBrokerCreateSessionResult,
  TerminalBrokerEvent,
  TerminalBrokerReadInput,
  TerminalBrokerResizeInput,
  TerminalBrokerSessionReference,
  TerminalBrokerSessionSnapshot,
  TerminalBrokerTerminateInput,
  TerminalBrokerWriteInput,
  ChatStreamCancellation,
} from '../../src/types/chat'

export const RUN_SERVICE_PROTOCOL_VERSION = 14

export interface RunServiceHello {
  buildId: string
  processId?: number
  protocolVersion: number
}

export type RunServiceRequest =
  | { id: string; token: string; method: 'hello'; params?: undefined }
  | { id: string; token: string; method: 'shutdown'; params?: undefined }
  | { id: string; token: string; method: 'getCompactionState'; params: { conversationId: string } }
  | { id: string; token: string; method: 'getConversationRuntime'; params: { conversationId: string; surface?: AppSettingsSurface } }
  | { id: string; token: string; method: 'getPendingFollowUps'; params: { streamId: string } }
  | { id: string; token: string; method: 'getRunProjection'; params: { runId: string } }
  | { id: string; token: string; method: 'listActiveRuns'; params?: undefined }
  | { id: string; token: string; method: 'ensureWorkspaceProject'; params: { workspacePath: string } }
  | { id: string; token: string; method: 'appendMessages'; params: AppendConversationMessagesInput }
  | { id: string; token: string; method: 'replaceMessages'; params: ReplaceConversationMessagesInput }
  | { id: string; token: string; method: 'compactConversation'; params: CompactConversationInput }
  | { id: string; token: string; method: 'startStream'; params: StartChatStreamInput }
  | { id: string; token: string; method: 'cancelStream'; params: { cancellation: ChatStreamCancellation; streamId: string } }
  | { id: string; token: string; method: 'updatePendingSteerMessages'; params: UpdatePendingSteerMessagesInput }
  | { id: string; token: string; method: 'updatePendingFollowUps'; params: UpdateSharedFollowUpsInput }
  | { id: string; token: string; method: 'claimPendingFollowUps'; params: ClaimSharedFollowUpsInput }
  | { id: string; token: string; method: 'submitToolDecision'; params: SubmitToolDecisionInput }
  | { id: string; token: string; method: 'updateConversationRuntime'; params: UpdateConversationRuntimeInput }
  | { id: string; token: string; method: 'terminalCreateSession'; params: TerminalBrokerCreateSessionInput }
  | { id: string; token: string; method: 'terminalAttachSession'; params: TerminalBrokerAttachInput }
  | { id: string; token: string; method: 'terminalDetachSession'; params: TerminalBrokerSessionReference }
  | { id: string; token: string; method: 'terminalListSessions'; params: { clientId?: string } }
  | { id: string; token: string; method: 'terminalGetSession'; params: TerminalBrokerSessionReference }
  | { id: string; token: string; method: 'terminalRead'; params: TerminalBrokerReadInput }
  | { id: string; token: string; method: 'terminalWrite'; params: TerminalBrokerWriteInput }
  | { id: string; token: string; method: 'terminalResize'; params: TerminalBrokerResizeInput }
  | { id: string; token: string; method: 'terminalTerminate'; params: TerminalBrokerTerminateInput }

export type RunServiceResponseResult =
  | RunServiceHello
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
  | TerminalBrokerAttachResult
  | TerminalBrokerCreateSessionResult
  | TerminalBrokerSessionSnapshot
  | TerminalBrokerSessionSnapshot[]
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

export interface RunServiceTerminalEventEnvelope {
  type: 'terminal_event'
  event: TerminalBrokerEvent
}

export type RunServiceWireMessage = RunServiceResponse | RunServiceEventEnvelope | RunServiceTerminalEventEnvelope

export function isRunServiceRequest(value: unknown): value is RunServiceRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.token === 'string'
    && typeof candidate.method === 'string'
}
