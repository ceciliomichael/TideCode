import type {
  AssistantWaitingIndicatorVariant,
  ChatAttachment,
  ChatMode,
  ConversationRecord,
  Message,
} from '../types/chat'
import type { ChatRuntimeSelection } from './chatMessageRuntime'

export interface ConversationRuntimeStatePatch {
  activeStreamId?: string | null
  isSending?: boolean
  isStreamingTextActive?: boolean
  streamingAssistantMessageId?: string | null
  streamingWaitingIndicatorVariant?: AssistantWaitingIndicatorVariant | null
}

export interface ConversationRuntimeSnapshot {
  activeStreamId: string | null
  conversation: ConversationRecord
  isSending?: boolean
}

export interface PersistedUserTurn {
  conversationId: string
  message: Message
}

export interface PersistAndStreamMessageInput {
  activeConversationId: string | null
  activeConversationIdRef: { current: string | null }
  applyConversation: (conversation: ConversationRecord) => void
  appendLocalMessage: (conversationId: string, message: Message) => void
  attachments: ChatAttachment[]
  clearError: () => void
  clearTextStreamingIdleTimeout: (conversationId: string) => void
  completeEditingMessage: () => void
  completeEditingAfterPersist?: boolean
  conversationRuntimeStatesRef: { current: Record<string, ConversationRuntimeSnapshot> }
  compactionSourceConversationId?: string
  draftChatMode: ChatMode
  markTextStreamingPulse: (conversationId: string) => void
  removeLocalMessage: (conversationId: string, messageId: string) => void
  runtimeSelection: ChatRuntimeSelection
  selectedFolderId: string | null
  selectedFolderIdRef: { current: string | null }
  hasPendingAbortRequest: () => boolean
  consumePendingAbortBeforeStreamStart: () => boolean
  onUserTurnPersisted?: (turn: PersistedUserTurn) => void
  onUserTurnSettled?: (turn: PersistedUserTurn) => void
  isUserMessageReverted?: (messageId: string) => boolean
  clearUserMessageRevert?: (messageId: string) => void
  setError: (errorMessage: string | null) => void
  setMainComposerAttachments: (attachments: ChatAttachment[]) => void
  setMainComposerMentionPathMap: (mentionPathMap: Map<string, string>) => void
  setMainComposerValue: (value: string) => void
  setPendingDraftSendCount: (updater: (currentValue: number) => number) => void
  resetMainComposerAfterSend?: boolean
  shouldRestoreMainComposerOnAbort?: () => boolean
  shouldApplyAbortRollbackToRuntime?: () => boolean
  syntheticAssistantMessage?: Message
  stopTextStreaming: (conversationId: string) => void
  targetEditMessageId: string | null
  originalText: string
  trimmedText: string
  title?: string
  updateConversationRuntimeState: (conversationId: string, input: ConversationRuntimeStatePatch) => void
  updateConversationSummary: (conversation: ConversationRecord) => void
  updateLocalMessage: (conversationId: string, messageId: string, updater: (message: Message) => Message) => void
  upsertConversation: (conversation: ConversationRecord) => void
}
