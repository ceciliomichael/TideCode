import { isChatAttachment } from '../../src/lib/chatAttachments'
import { normalizeAssistantMessageContent } from '../../src/lib/chatMessageContent'
import { getConversationPreviewContent } from '../../src/lib/chatMessageMetadata'
import type {
  ChatMode,
  ConversationCompaction,
  ConversationFolderRecord,
  ConversationRecord,
  ConversationSummary,
  ToolInvocationResultPresentation,
  Message,
  UserMessageRunCheckpoint,
} from '../../src/types/chat'

export interface MessageLogEntry {
  conversationId: string
  message: Message
  loggedAt: number
}

interface FolderStoreDocument {
  folders: ConversationFolderRecord[]
}

interface ChangeDiffPresentationItem {
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

function normalizeChatMode(value: unknown): ChatMode {
  return value === 'plan' ? 'plan' : 'agent'
}

function normalizeConversationCompaction(value: unknown): ConversationCompaction | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const compaction = value as Partial<ConversationCompaction>
  const rootConversationId = compaction.rootConversationId?.trim() ?? ''
  const sourceConversationId = compaction.sourceConversationId?.trim() ?? ''
  if (
    rootConversationId.length === 0 ||
    sourceConversationId.length === 0 ||
    typeof compaction.compactedAt !== 'number' ||
    !Number.isFinite(compaction.compactedAt) ||
    typeof compaction.depth !== 'number' ||
    !Number.isInteger(compaction.depth) ||
    compaction.depth < 1 ||
    typeof compaction.sequence !== 'number' ||
    !Number.isInteger(compaction.sequence) ||
    compaction.sequence < 1
  ) {
    return undefined
  }

  return {
    compactedAt: compaction.compactedAt,
    depth: compaction.depth,
    rootConversationId,
    sequence: compaction.sequence,
    sourceConversationId,
  }
}

function isToolInvocationResultPresentation(value: unknown): value is ToolInvocationResultPresentation {
  if (!value || typeof value !== 'object') {
    return false
  }

  const presentation = value as Partial<ToolInvocationResultPresentation>
  if (presentation.kind === 'file_diff') {
    return (
      typeof presentation.fileName === 'string' &&
      (presentation.oldContent === null || typeof presentation.oldContent === 'string') &&
      typeof presentation.newContent === 'string' &&
      (presentation.addedLineCount === undefined || typeof presentation.addedLineCount === 'number') &&
      (presentation.removedLineCount === undefined || typeof presentation.removedLineCount === 'number') &&
      (presentation.startLineNumber === undefined || typeof presentation.startLineNumber === 'number') &&
      (presentation.endLineNumber === undefined || typeof presentation.endLineNumber === 'number') &&
      (presentation.contextLines === undefined || typeof presentation.contextLines === 'number')
    )
  }

  if (presentation.kind === 'change_diff') {
    return Array.isArray(presentation.changes) && presentation.changes.every((change) => isChangeDiffItem(change))
  }

  return false
}

function isChangeDiffItem(value: unknown): value is ChangeDiffPresentationItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Partial<ChangeDiffPresentationItem>
  return (
    typeof item.fileName === 'string' &&
    (item.kind === 'add' || item.kind === 'delete' || item.kind === 'update') &&
    (item.oldContent === null || typeof item.oldContent === 'string') &&
    typeof item.newContent === 'string' &&
    (item.addedLineCount === undefined || typeof item.addedLineCount === 'number') &&
    (item.removedLineCount === undefined || typeof item.removedLineCount === 'number') &&
    (item.startLineNumber === undefined || typeof item.startLineNumber === 'number') &&
    (item.endLineNumber === undefined || typeof item.endLineNumber === 'number') &&
    (item.contextLines === undefined || typeof item.contextLines === 'number')
  )
}

function isToolInvocationTrace(value: unknown) {
  if (!value || typeof value !== 'object') {
    return false
  }

  const invocation = value as Partial<NonNullable<Message['toolInvocations']>[number]>
  return (
    typeof invocation.id === 'string' &&
    typeof invocation.toolName === 'string' &&
    typeof invocation.argumentsText === 'string' &&
    typeof invocation.startedAt === 'number' &&
    (invocation.completedAt === undefined || typeof invocation.completedAt === 'number') &&
    (invocation.resultContent === undefined || typeof invocation.resultContent === 'string') &&
    (invocation.resultPresentation === undefined || isToolInvocationResultPresentation(invocation.resultPresentation)) &&
    (invocation.state === 'running' || invocation.state === 'completed' || invocation.state === 'failed')
  )
}

function isUserMessageRunCheckpoint(value: unknown): value is UserMessageRunCheckpoint {
  if (!value || typeof value !== 'object') {
    return false
  }

  const checkpoint = value as Partial<UserMessageRunCheckpoint>
  return typeof checkpoint.id === 'string' && typeof checkpoint.createdAt === 'number'
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as Partial<Message>
  const hasValidProviderId = message.providerId === undefined || typeof message.providerId === 'string'
  const hasValidReasoningEffort = message.reasoningEffort === undefined || typeof message.reasoningEffort === 'string'
  const hasValidUserMessageKind =
    message.userMessageKind === undefined ||
    message.userMessageKind === 'human' ||
    message.userMessageKind === 'tool_result'
  const hasValidToolCallId = message.toolCallId === undefined || typeof message.toolCallId === 'string'
  const hasRequiredToolCallId =
    message.role !== 'tool' || (typeof message.toolCallId === 'string' && message.toolCallId.trim().length > 0)
  const hasValidToolInvocations =
    message.toolInvocations === undefined ||
    (Array.isArray(message.toolInvocations) && message.toolInvocations.every((entry) => isToolInvocationTrace(entry)))
  const hasValidAttachments =
    message.attachments === undefined ||
    (Array.isArray(message.attachments) && message.attachments.every((attachment) => isChatAttachment(attachment)))
  const hasValidRunCheckpoint =
    message.runCheckpoint === undefined || isUserMessageRunCheckpoint(message.runCheckpoint)

  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'tool') &&
    typeof message.content === 'string' &&
    typeof message.timestamp === 'number' &&
    (message.modelId === undefined || typeof message.modelId === 'string') &&
    hasValidProviderId &&
    (message.reasoningContent === undefined || typeof message.reasoningContent === 'string') &&
    (message.reasoningCompletedAt === undefined || typeof message.reasoningCompletedAt === 'number') &&
    hasValidReasoningEffort &&
    hasValidUserMessageKind &&
    hasValidToolCallId &&
    hasRequiredToolCallId &&
    hasValidToolInvocations &&
    hasValidAttachments &&
    hasValidRunCheckpoint
  )
}

function isConversationFolderRecord(value: unknown): value is ConversationFolderRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const folder = value as Partial<ConversationFolderRecord>
  return (
    typeof folder.id === 'string' &&
    typeof folder.name === 'string' &&
    typeof folder.path === 'string' &&
    typeof folder.createdAt === 'number' &&
    typeof folder.updatedAt === 'number'
  )
}

export function normalizeConversationRecord(
  conversation: Partial<ConversationRecord> & { id: string },
): ConversationRecord {
  const createdAt = typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now()
  const messages = Array.isArray(conversation.messages) ? conversation.messages.filter(isMessage) : []
  const compaction = normalizeConversationCompaction(conversation.compaction)

  return {
    id: conversation.id,
    title: typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title : 'New chat',
    createdAt,
    updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : createdAt,
    chatMode: normalizeChatMode(conversation.chatMode),
    ...(compaction ? { compaction } : {}),
    agentContextRootPath:
      typeof conversation.agentContextRootPath === 'string' ? conversation.agentContextRootPath.trim() : '',
    folderId: typeof conversation.folderId === 'string' ? conversation.folderId : null,
    messages: messages.map((message) =>
      message.role === 'assistant'
        ? {
            ...message,
            ...normalizeAssistantMessageContent(message),
            ...(message.runCheckpoint ? { runCheckpoint: message.runCheckpoint } : {}),
          }
        : {
            ...message,
            ...(message.runCheckpoint ? { runCheckpoint: message.runCheckpoint } : {}),
          },
    ),
    isArchived: Boolean(conversation.isArchived),
    isPinned: Boolean(conversation.isPinned) && !conversation.isArchived,
  }
}

export function buildConversationSummary(conversation: ConversationRecord): ConversationSummary {
  return {
    agentContextRootPath: conversation.agentContextRootPath,
    chatMode: conversation.chatMode,
    ...(conversation.compaction ? { compaction: conversation.compaction } : {}),
    id: conversation.id,
    title: conversation.title,
    preview: getConversationPreviewContent(conversation.messages),
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    folderId: conversation.folderId,
    isArchived: conversation.isArchived,
    isPinned: conversation.isPinned && !conversation.isArchived,
  }
}

export function parseFolderStore(raw: string) {
  const parsed = JSON.parse(raw) as Partial<FolderStoreDocument>
  const folders = Array.isArray(parsed.folders) ? parsed.folders : []

  return folders
    .filter(isConversationFolderRecord)
    .map((folder) => ({
      ...folder,
      name: folder.name.trim(),
      path: folder.path.trim(),
    }))
}

export function serializeFolderStore(folders: ConversationFolderRecord[]) {
  const payload: FolderStoreDocument = { folders }
  return JSON.stringify(payload, null, 2)
}

export function createMessageLogPayload(conversationId: string, messages: Message[], loggedAt = Date.now()) {
  return messages
    .map((message) =>
      JSON.stringify({
        conversationId,
        message,
        loggedAt,
      } satisfies MessageLogEntry),
    )
    .join('\n')
}
