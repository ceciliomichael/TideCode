import type { ChatCompactionLifecycleState, ChatStreamEvent, CompactConversationInput, CompactConversationResult, ContextUsageEstimate, StartChatStreamInput } from './runtime'
import type { ChatMode, ConversationFolderRecord, ConversationRecord, QueuedMessage } from './conversations'
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
  contextUsage: ContextUsageEstimate | null
  status: SharedRunStatus
  startedAt: number
  updatedAt: number
  lastEventSeq: number
}

export interface SharedRunProjection {
  runId: string
  conversationId: string
  revision: number
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

export type SharedFollowUpBehavior = 'steer' | 'queue'

export interface SharedFollowUpItem {
  behavior: SharedFollowUpBehavior
  message: QueuedMessage
}

export interface SharedFollowUpSnapshot {
  conversationId: string
  items: SharedFollowUpItem[]
  revision: number
  runId: string
  streamId: string
}

export type SharedFollowUpMutation =
  | { type: 'add'; item: SharedFollowUpItem }
  | { type: 'update'; message: QueuedMessage }
  | { type: 'remove'; id: string }
  | { type: 'reorder'; sourceId: string; targetId: string }

export interface UpdateSharedFollowUpsInput {
  mutation: SharedFollowUpMutation
  streamId: string
}

export interface ClaimSharedFollowUpsInput {
  streamId: string
}

export interface ClaimSharedFollowUpsResult {
  messages: QueuedMessage[]
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
      type: 'project_registered'
      seq: number
      folder: ConversationFolderRecord
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
  | {
      type: 'follow_ups_updated'
      seq: number
      snapshot: SharedFollowUpSnapshot
    }

export interface TideCodeRunsApi {
  compactConversation: (input: CompactConversationInput) => Promise<CompactConversationResult>
  getCompactionState: (conversationId: string) => Promise<ChatCompactionLifecycleState | null>
  getConversationRuntime: (conversationId: string) => Promise<SharedConversationRuntimeSnapshot | null>
  getPendingFollowUps: (streamId: string) => Promise<SharedFollowUpSnapshot | null>
  getRunProjection: (runId: string) => Promise<SharedRunProjection | null>
  listActiveRuns: () => Promise<SharedRunSnapshot[]>
  onEvent: (listener: (event: TideCodeRunEvent) => void) => () => void
  claimPendingFollowUps: (input: ClaimSharedFollowUpsInput) => Promise<ClaimSharedFollowUpsResult>
  updateConversationRuntime: (input: UpdateConversationRuntimeInput) => Promise<SharedConversationRuntimeSnapshot>
  updatePendingFollowUps: (input: UpdateSharedFollowUpsInput) => Promise<SharedFollowUpSnapshot>
}
