import type { ContextCompactionSettings } from '../../lib/contextCompactionSettings'
import type {
  ChatMode,
  Message,
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

export interface CompressChatHistoryInput {
  agentContextRootPath: string
  chatMode: ChatMode
  messages: Message[]
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

export interface CompactConversationInput extends CompressChatHistoryInput {
  conversationId: string
  contextCompaction: ContextCompactionSettings
  targetModelId?: string
  targetProviderId?: ChatProviderId
  terminalExecutionMode: AppTerminalExecutionMode
}

export interface CompactConversationResult {
  compacted: boolean
  packetId: string | null
  usedFallback: boolean
}

export interface StartChatStreamResult {
  streamId: string
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

export interface ChatCompactionDetailSection {
  items: string[]
  label: string
}

export type ChatStreamEvent =
  | { streamId: string; type: 'started' }
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
  | { streamId: string; type: 'completed' }
  | { streamId: string; type: 'aborted' }
  | { errorMessage: string; streamId: string; type: 'error' }
