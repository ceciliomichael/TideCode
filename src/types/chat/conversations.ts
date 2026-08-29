import type { ChatProviderId, ReasoningEffort } from './providers'
import type { PlanToolResultPresentation } from '../../lib/planContracts'

export type MessageRole = 'user' | 'assistant' | 'tool'
export type ChatMode = 'agent' | 'plan'
export type UserMessageKind = 'human' | 'steer' | 'tool_result'
export type ToolInvocationState = 'running' | 'completed' | 'failed'
export type AssistantWaitingIndicatorVariant = 'thinking' | 'splash' | 'rate_limit_retry'
export type ChatAttachmentKind = 'image' | 'text'
export type ToolDecisionKind = 'ready_implement' | 'ask_question'

export interface ToolDecisionOption {
  id: string
  label: string
}

export interface ToolDecisionRequest {
  allowCustomAnswer: boolean
  kind: ToolDecisionKind
  options: ToolDecisionOption[]
  prompt: string
  streamId: string
}

export interface HiddenUserContext {
  content: string
  kind: string
  state?: string
}

export interface FileDiffToolResultPresentation {
  addedLineCount?: number
  contextLines?: number
  endLineNumber?: number
  fileName: string
  kind: 'file_diff'
  newContent: string
  oldContent: string | null
  removedLineCount?: number
  startLineNumber?: number
}

export interface ChangeDiffToolResultItem {
  addedLineCount?: number
  contextLines?: number
  endLineNumber?: number
  fileName: string
  kind: 'add' | 'delete' | 'update'
  newContent: string
  oldContent: string | null
  removedLineCount?: number
  startLineNumber?: number
}

export interface ChangeDiffToolResultPresentation {
  changes: ChangeDiffToolResultItem[]
  kind: 'change_diff'
}

export interface ImageToolResultPresentation {
  fileName: string
  kind: 'image'
  mediaType: string
  relativePath: string
}

export type ToolInvocationResultPresentation =
  | ChangeDiffToolResultPresentation
  | FileDiffToolResultPresentation
  | ImageToolResultPresentation
  | PlanToolResultPresentation

interface ChatAttachmentBase {
  fileName: string
  id: string
  kind: ChatAttachmentKind
  mimeType: string
  sizeBytes: number
}

export interface ChatImageAttachment extends ChatAttachmentBase {
  dataUrl: string
  height?: number
  kind: 'image'
  width?: number
}

export interface ChatTextAttachment extends ChatAttachmentBase {
  kind: 'text'
  textContent: string
}

export type ChatAttachment = ChatImageAttachment | ChatTextAttachment

export interface QueuedMessage {
  attachments?: ChatAttachment[]
  content: string
  id: string
  mentionPathMap?: Record<string, string>
  timestamp: number
}

export interface ToolInvocationTrace {
  argumentsText: string
  completedAt?: number
  decisionRequest?: ToolDecisionRequest
  id: string
  resultContent?: string
  resultPresentation?: ToolInvocationResultPresentation
  startedAt: number
  state: ToolInvocationState
  toolName: string
}

export interface Message {
  attachments?: ChatAttachment[]
  chatMode?: ChatMode
  hiddenUserContext?: HiddenUserContext[]
  id: string
  role: MessageRole
  content: string
  mentionPathMap?: Record<string, string>
  modelId?: string
  providerId?: ChatProviderId
  reasoningContent?: string
  reasoningCompletedAt?: number
  reasoningEffort?: ReasoningEffort
  runCheckpoint?: UserMessageRunCheckpoint
  timestamp: number
  toolCallId?: string
  toolInvocations?: ToolInvocationTrace[]
  userMessageKind?: UserMessageKind
}

export interface UserMessageRunCheckpoint {
  createdAt: number
  id: string
}

export interface ConversationCompaction {
  compactedAt: number
  depth: number
  rootConversationId: string
  sequence: number
  sourceConversationId: string
}

export interface ConversationSummary {
  agentContextRootPath: string
  chatMode: ChatMode
  compaction?: ConversationCompaction
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
  folderId: string | null
  isArchived?: boolean
  isPinned?: boolean
}

export interface ConversationPreview {
  compaction?: ConversationCompaction
  compactionLabel?: string
  hasCompactionFamily?: boolean
  id: string
  isLatestCompaction?: boolean
  title: string
  preview: string
  updatedAt: number
  updatedAtLabel: string
  folderId: string | null
  isArchived?: boolean
  isActive?: boolean
  hasRunningTask?: boolean
  isPinned?: boolean
}

export interface ConversationRecord {
  agentContextRootPath: string
  chatMode: ChatMode
  compaction?: ConversationCompaction
  id: string
  title: string
  createdAt: number
  updatedAt: number
  folderId: string | null
  isArchived?: boolean
  messages: Message[]
  isPinned?: boolean
}

export interface ConversationFolderRecord {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface ConversationFolderSummary {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface ProjectFolderPrunedEvent {
  deletedConversationIds: string[]
  folderId: string
}

export interface ConversationFolderPreview {
  id: string | null
  name: string
  path: string | null
  conversationCount: number
  isSelected?: boolean
}

export interface ConversationGroupPreview {
  folder: ConversationFolderPreview
  conversations: ConversationPreview[]
}

export interface CreateConversationInput {
  chatMode?: ChatMode
  compactionSourceConversationId?: string
  folderId?: string | null
}

export interface CreateConversationFolderInput {
  name: string
  path: string
}

export interface RenameConversationFolderInput {
  folderId: string
  name: string
}

export type FolderMoveDirection = 'up' | 'down'
export type FolderReorderPosition = 'before' | 'after'

export interface ReorderConversationFolderInput {
  folderId: string
  targetFolderId: string
  position: FolderReorderPosition
}

export interface AppendConversationMessagesInput {
  chatMode?: ChatMode
  conversationId: string
  messages: Message[]
  title?: string
}

export interface ReplaceConversationMessagesInput {
  chatMode?: ChatMode
  conversationId: string
  messages: Message[]
  synchronizeCanonicalHistory?: boolean
  title?: string
}
