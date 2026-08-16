import type { ChatCompactionLifecycleState, ChatStreamEvent, CompactConversationInput, CompactConversationResult, StartChatStreamInput } from './runtime'
import type { ChatMode, ConversationRecord } from './conversations'
import type { ChatProviderId, ReasoningEffort } from './providers'

export type SharedRunStatus =
  | 'starting'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface SharedRunSnapshot {
  runId: string
  streamId: string | null
  conversationId: string
  providerId: StartChatStreamInput['providerId']
  modelId: string
  workspaceRootPath: string
  status: SharedRunStatus
  startedAt: number
  updatedAt: number
  lastEventSeq: number
}

export interface SharedRunProjection {
  runId: string
  conversationId: string
  baseMessageCount: number
  messages: ConversationRecord['messages']
  streamingAssistantMessageId: string | null
  streamingWaitingIndicatorVariant: 'thinking' | 'splash' | 'rate_limit_retry' | null
  isStreamingTextActive: boolean
}

export type ChatCompactionEvent = Extract<
  ChatStreamEvent,
  { type: 'compaction_started' | 'compaction_committed' | 'compaction_failed' }
>

export interface SharedConversationRuntimeModel {
  label: string
  modelId: string
  providerId: ChatProviderId | null
  reasoningEffort?: ReasoningEffort
  runtimeModelId?: string
}

export interface SharedConversationRuntimeSnapshot {
  conversationId: string
  chatMode: ChatMode
  model: SharedConversationRuntimeModel | null
  updatedAt: number
}

export interface UpdateConversationRuntimeInput {
  conversationId: string
  chatMode?: ChatMode
  model?: SharedConversationRuntimeModel
}

export type TideCodeRunEvent =
  | {
      type: 'run_state'
      seq: number
      run: SharedRunSnapshot
    }
  | {
      type: 'chat_event'
      seq: number
      runId: string
      conversationId: string
      event: ChatStreamEvent
    }
  | {
      type: 'conversation_updated'
      seq: number
      runId: string
      conversationId: string
      conversation: ConversationRecord
    }
  | {
      type: 'run_projection'
      seq: number
      projection: SharedRunProjection
    }
  | {
      type: 'conversation_appended'
      seq: number
      conversationId: string
      conversation: ConversationRecord
    }
  | {
      type: 'conversation_replaced'
      seq: number
      conversationId: string
      conversation: ConversationRecord
    }
  | {
      type: 'compaction_event'
      seq: number
      conversationId: string
      event: ChatCompactionEvent
    }
  | {
      type: 'conversation_runtime_updated'
      seq: number
      conversationId: string
      runtime: SharedConversationRuntimeSnapshot
    }

export interface TideCodeRunsApi {
  compactConversation: (input: CompactConversationInput) => Promise<CompactConversationResult>
  getCompactionState: (conversationId: string) => Promise<ChatCompactionLifecycleState | null>
  getConversationRuntime: (conversationId: string) => Promise<SharedConversationRuntimeSnapshot | null>
  getRunProjection: (runId: string) => Promise<SharedRunProjection | null>
  listActiveRuns: () => Promise<SharedRunSnapshot[]>
  onEvent: (listener: (event: TideCodeRunEvent) => void) => () => void
  updateConversationRuntime: (input: UpdateConversationRuntimeInput) => Promise<SharedConversationRuntimeSnapshot>
}
