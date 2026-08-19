import type { ContextCompactionSettings } from '../../lib/contextCompactionSettings'
import type {
  ChatMode,
  Message,
  QueuedMessage,
  ToolDecisionKind,
  ToolDecisionOption,
  ToolInvocationResultPresentation,
} from './conversations'
import type { ChatProviderId, ReasoningEffort } from './providers'
import type { AppTerminalExecutionMode } from './settings'

export interface StartChatStreamInput {
  agentContextRootPath: string
  cacheScopeId?: string
  chatMode: ChatMode
  contextCompaction: ContextCompactionSettings
  conversationId?: string
  messages: Message[]
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  terminalExecutionMode: AppTerminalExecutionMode
}

export interface CompactConversationInput {
  agentContextRootPath: string
  chatMode: ChatMode
  contextCompaction: ContextCompactionSettings
  conversationId: string
  messages: Message[]
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  targetModelId?: string
  targetProviderId?: ChatProviderId
  terminalExecutionMode: AppTerminalExecutionMode
}

export interface CompactConversationResult {
  compacted: boolean
  packetId: string | null
}

export interface StartChatStreamResult {
  streamId: string
}

export interface UpdatePendingSteerMessagesInput {
  messages: QueuedMessage[]
  revision: number
  streamId: string
}

export interface UpdatePendingSteerMessagesResult {
  accepted: boolean
}

export interface SubmitToolDecisionInput {
  customAnswer?: string
  invocationId: string
  selectedOptionId?: string
  streamId: string
}

export interface SubmitToolDecisionResult {
  accepted: boolean
}

export interface EstimateContextUsageInput {
  agentContextRootPath: string | null
  chatMode: ChatMode
  contextCompaction: ContextCompactionSettings
  conversationId?: string | null
  messages: Message[]
  modelId?: string
  providerId: ChatProviderId
  terminalExecutionMode: AppTerminalExecutionMode
}

export interface ContextUsageEstimate {
  historyTokens: number
  maxTokens: number
  systemPromptTokens: number
  toolResultsTokens: number
  totalTokens: number
}

export interface ChatCompactionMarker {
  anchorUserMessageId: string | null
  compactionId: string
  createdAt: number
  detailSections: ChatCompactionDetailSection[]
}

export type ChatCompactionLifecycleState =
  | {
      attemptId: string
      phase: 'compacting'
      streamId: string
    }
  | {
      attemptId: string
      compactionId: string
      phase: 'compacted'
      streamId: string
    }

export interface ChatCompactionDetailSection {
  items: string[]
  label?: string
}

export type ChatStreamEvent =
  | { streamId: string; type: 'started' }
  | {
      conversationId: string
      streamId: string
      type: 'context_usage_updated'
      usage: ContextUsageEstimate
    }
  | {
      attemptId: string
      conversationId: string
      streamId: string
      type: 'compaction_started'
    }
  | {
      compactionId: string
      conversationId: string
      streamId: string
      type: 'compaction_committed'
    }
  | {
      attemptId: string
      conversationId: string
      reason: 'aborted' | 'error' | 'unavailable'
      streamId: string
      type: 'compaction_failed'
    }
  | { delta: string; streamId: string; type: 'content_delta' }
  | { delta: string; streamId: string; type: 'reasoning_delta' }
  | { streamId: string; type: 'reasoning_completed' }
  | {
      allowCustomAnswer: boolean
      invocationId: string
      kind: ToolDecisionKind
      options: ToolDecisionOption[]
      prompt: string
      streamId: string
      toolName: string
      type: 'tool_invocation_decision_requested'
    }
  | {
      argumentsText: string
      invocationId: string
      startedAt: number
      streamId: string
      toolName: string
      type: 'tool_invocation_started'
    }
  | {
      argumentsText: string
      invocationId: string
      streamId: string
      toolName: string
      type: 'tool_invocation_delta'
    }
  | {
      argumentsText: string
      completedAt: number
      invocationId: string
      resultContent: string
      resultPresentation?: ToolInvocationResultPresentation
      streamId: string
      syntheticMessage: Message
      toolName: string
      type: 'tool_invocation_completed'
    }
  | {
      argumentsText: string
      completedAt: number
      errorMessage: string
      invocationId: string
      resultContent: string
      resultPresentation?: ToolInvocationResultPresentation
      streamId: string
      syntheticMessage: Message
      toolName: string
      type: 'tool_invocation_failed'
    }
  | {
      messages: Message[]
      streamId: string
      type: 'steer_messages_consumed'
    }
  | { conversationId?: string | null; streamId: string; type: 'completed' }
  | { conversationId?: string | null; streamId: string; type: 'aborted' }
  | { conversationId?: string | null; errorMessage: string; streamId: string; type: 'error' }
