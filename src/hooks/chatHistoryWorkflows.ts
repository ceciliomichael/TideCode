import { v4 as uuidv4 } from 'uuid'
import type {
  ChatAttachment,
  ChatMode,
  ConversationFolderSummary,
  ConversationRecord,
  ConversationSummary,
  Message,
  ReasoningEffort,
  ChatProviderId,
  UserMessageRunCheckpoint,
} from '../types/chat'
import { getConversationTitleFromInput } from './chatHistoryViewModels'
import { hasPlanToolInvocation } from '../lib/planPresentation'
import {
  loadChatCompactionMarkers,
  prefetchChatCompactionMarkers,
} from '../lib/chatCompactionMarkerCache'
import { isSameTurnSteerMessage } from '../lib/chatMessageMetadata'
import type { UserMessageSubmission } from './chatMessageSendTypes'

export interface ChatHistorySnapshot {
  conversationSummaries: ConversationSummary[]
  folderSummaries: ConversationFolderSummary[]
  initialConversation: ConversationRecord | null
  initialSelectedFolderId: string | null
}

interface PersistUserTurnInput {
  activeConversationId: string | null
  chatMode: ChatMode
  compactionSourceConversationId?: string
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  selectedFolderId: string | null
  targetEditMessageId: string | null
  attachments: ChatAttachment[]
  messages: readonly UserMessageSubmission[]
  trimmedText: string
  title?: string
}

interface PersistUserTurnResult {
  conversation: ConversationRecord
  userMessage: Message
}

export interface RevertPreparationResult {
  checkpointIds: string[]
  messageId: string
  redoCheckpointId: string
  revertedChatMode: ChatMode
}

function buildUserMessage(
  trimmedText: string,
  modelId: string,
  providerId: ChatProviderId,
  reasoningEffort: ReasoningEffort,
  attachments: ChatAttachment[],
  runCheckpoint: UserMessageRunCheckpoint,
  chatMode: ChatMode,
  forcedId?: string,
): Message {
  return {
    attachments: attachments.length > 0 ? attachments : undefined,
    chatMode,
    content: trimmedText,
    id: forcedId ?? uuidv4(),
    modelId,
    providerId,
    reasoningEffort,
    role: 'user',
    runCheckpoint,
    timestamp: Date.now(),
  }
}

async function loadStoredConversationOrThrow(conversationId: string) {
  try {
    const conversation = await window.tidecodeHistory.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    return conversation
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Conversation not found:')) {
      throw error
    }

    throw new Error(`Unable to load conversation: ${conversationId}`)
  }
}

async function loadConversationForInitialView(conversationId: string) {
  void loadChatCompactionMarkers(conversationId).catch((error) => {
    console.error(`Failed to preload chat compaction markers: ${conversationId}`, error)
  })
  return window.tidecodeHistory.getConversation(conversationId)
}

function findUserMessageOrThrow(conversation: ConversationRecord, messageId: string) {
  const targetMessageIndex = conversation.messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )

  if (targetMessageIndex < 0) {
    throw new Error(`Message not found: ${messageId}`)
  }

  const targetMessage = conversation.messages[targetMessageIndex]
  return {
    targetMessage,
    targetMessageIndex,
  }
}

function isIndependentUserTurn(message: Message) {
  return message.role === 'user' && !isSameTurnSteerMessage(message)
}

function resolveRevertTarget(conversation: ConversationRecord, messageId: string) {
  const selectedTarget = findUserMessageOrThrow(conversation, messageId)
  if (!isSameTurnSteerMessage(selectedTarget.targetMessage)) {
    return selectedTarget
  }

  for (let index = selectedTarget.targetMessageIndex - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (isIndependentUserTurn(message)) {
      return {
        targetMessage: message,
        targetMessageIndex: index,
      }
    }
  }

  throw new Error(`Same-turn steer message does not have a parent user turn: ${messageId}`)
}

function resolveRevertedChatMode(conversation: ConversationRecord, targetMessageIndex: number): ChatMode {
  const targetMessage = conversation.messages[targetMessageIndex]
  if (targetMessage?.chatMode) {
    return targetMessage.chatMode
  }

  const nextUserMessageIndex = conversation.messages.findIndex(
    (message, index) => index > targetMessageIndex && isIndependentUserTurn(message),
  )
  const turnEndIndex = nextUserMessageIndex < 0 ? conversation.messages.length : nextUserMessageIndex
  const turnMessages = conversation.messages.slice(targetMessageIndex + 1, turnEndIndex)
  if (hasPlanToolInvocation(turnMessages)) {
    return 'plan'
  }

  return conversation.chatMode
}

async function resolveUserMessageCheckpointIdOrThrow(conversation: ConversationRecord, targetMessageIndex: number) {
  const targetMessage = conversation.messages[targetMessageIndex]
  const directCheckpointId = targetMessage?.runCheckpoint?.id
  if (directCheckpointId) {
    return directCheckpointId
  }

  const checkpointHistory = await window.tidecodeHistory.getUserMessageCheckpointHistory(conversation.id, targetMessage.id)
  if (checkpointHistory.length > 0) {
    return checkpointHistory.at(-1)?.id ?? checkpointHistory[0].id
  }

  throw new Error(`This message does not have a workspace checkpoint: ${targetMessage.id}`)
}

async function resolveRevertCheckpointIdsOrThrow(conversation: ConversationRecord, targetMessageIndex: number) {
  const checkpointIds: string[] = []

  for (let index = targetMessageIndex; index < conversation.messages.length; index += 1) {
    const currentMessage = conversation.messages[index]
    if (!isIndependentUserTurn(currentMessage)) {
      continue
    }

    checkpointIds.push(await resolveUserMessageCheckpointIdOrThrow(conversation, index))
  }

  if (checkpointIds.length === 0) {
    throw new Error('This message and later user messages do not have a workspace checkpoint.')
  }

  return checkpointIds
}

async function findUserMessageForRevertOrThrow(conversation: ConversationRecord, messageId: string) {
  const { targetMessage, targetMessageIndex } = resolveRevertTarget(conversation, messageId)
  const checkpointIds = await resolveRevertCheckpointIdsOrThrow(conversation, targetMessageIndex)

  return {
    checkpointIds,
    targetMessage,
    targetMessageIndex,
  }
}

async function createRunCheckpoint(agentContextRootPath: string) {
  return window.tidecodeWorkspace.createCheckpoint({
    workspaceRootPath: agentContextRootPath,
  })
}

export async function loadInitialChatHistory(
  preferredConversationId?: string | null,
  openEmptyConversationOnLaunch = false,
  preferredDraftFolderId?: string | null,
): Promise<ChatHistorySnapshot> {
  const normalizedPreferredConversationId = preferredConversationId?.trim() ?? ''
  const preferredConversationPromise =
    !openEmptyConversationOnLaunch && normalizedPreferredConversationId.length > 0
      ? loadConversationForInitialView(normalizedPreferredConversationId)
      : Promise.resolve(null)
  const [conversationSummaries, folderSummaries, prefetchedPreferredConversation] = await Promise.all([
    window.tidecodeHistory.listConversations(),
    window.tidecodeHistory.listFolders(),
    preferredConversationPromise,
  ])
  void prefetchChatCompactionMarkers(conversationSummaries.map((conversation) => conversation.id))

  const normalizedPreferredDraftFolderId = preferredDraftFolderId?.trim() ?? ''
  const validPreferredFolderId =
    normalizedPreferredDraftFolderId.length > 0 &&
    folderSummaries.some((folderSummary) => folderSummary.id === normalizedPreferredDraftFolderId)
      ? normalizedPreferredDraftFolderId
      : null

  if (conversationSummaries.length === 0 || openEmptyConversationOnLaunch) {
    if (!validPreferredFolderId && window.tidecodeHistory.ensureDraftAgentContext) {
      await window.tidecodeHistory.ensureDraftAgentContext()
    }

    return {
      conversationSummaries,
      folderSummaries,
      initialConversation: null,
      initialSelectedFolderId: validPreferredFolderId,
    }
  }

  const preferredConversationSummary =
    normalizedPreferredConversationId.length > 0
      ? conversationSummaries.find((summary) => summary.id === normalizedPreferredConversationId)
      : null

  if (preferredConversationSummary) {
    if (!validPreferredFolderId || preferredConversationSummary.folderId === validPreferredFolderId) {
      const initialConversation = prefetchedPreferredConversation
      if (initialConversation) {
        return {
          conversationSummaries,
          folderSummaries,
          initialConversation,
          initialSelectedFolderId: initialConversation.folderId ?? validPreferredFolderId,
        }
      }
    }
  }

  if (validPreferredFolderId) {
    const emptyProjectConversationSummary = conversationSummaries.find(
      (summary) =>
        summary.folderId === validPreferredFolderId &&
        (summary.preview.trim() === '' || summary.preview === 'New Chat'),
    )
    if (emptyProjectConversationSummary) {
      const initialConversation = await loadConversationForInitialView(emptyProjectConversationSummary.id)
      if (initialConversation) {
        return {
          conversationSummaries,
          folderSummaries,
          initialConversation,
          initialSelectedFolderId: validPreferredFolderId,
        }
      }
    }

    return {
      conversationSummaries,
      folderSummaries,
      initialConversation: null,
      initialSelectedFolderId: validPreferredFolderId,
    }
  }

  const fallbackSummary = conversationSummaries[0]
  const initialConversation = await loadConversationForInitialView(fallbackSummary.id)

  return {
    conversationSummaries,
    folderSummaries,
    initialConversation,
    initialSelectedFolderId: initialConversation?.folderId ?? null,
  }
}

export async function persistUserTurn(input: PersistUserTurnInput): Promise<PersistUserTurnResult> {
  if (input.messages.length === 0) {
    throw new Error('Cannot persist an empty user message batch.')
  }

  const normalizedMessages = input.messages.map((message) => ({
    attachments: message.attachments,
    text: message.text.trim(),
  }))
  if (normalizedMessages.every((message) => message.text.length === 0 && message.attachments.length === 0)) {
    throw new Error('Cannot persist an empty user message batch.')
  }

  if (input.targetEditMessageId !== null) {
    if (!input.activeConversationId) {
      throw new Error('Cannot edit a message without an active conversation.')
    }

    if (normalizedMessages.length !== 1) {
      throw new Error('Cannot edit multiple user messages in one request.')
    }

    const currentConversation = await loadStoredConversationOrThrow(input.activeConversationId)
    const runCheckpoint = await createRunCheckpoint(currentConversation.agentContextRootPath)
    const userMessage = buildUserMessage(
      normalizedMessages[0].text,
      input.modelId,
      input.providerId,
      input.reasoningEffort,
      normalizedMessages[0].attachments,
      runCheckpoint,
      input.chatMode,
      input.targetEditMessageId,
    )
    const targetMessageIndex = currentConversation.messages.findIndex(
      (message) => message.id === input.targetEditMessageId && message.role === 'user',
    )

    if (targetMessageIndex < 0) {
      throw new Error(`Message not found: ${input.targetEditMessageId}`)
    }

    const rewrittenMessages = [...currentConversation.messages.slice(0, targetMessageIndex), userMessage]
    const conversation = await window.tidecodeHistory.replaceMessages({
      chatMode: input.chatMode,
      conversationId: currentConversation.id,
      messages: rewrittenMessages,
      synchronizeCanonicalHistory: true,
      title:
        targetMessageIndex === 0
          ? input.title?.trim() || getConversationTitleFromInput(normalizedMessages[0].text, normalizedMessages[0].attachments)
          : undefined,
    })

    return {
      conversation,
      userMessage,
    }
  }

  let conversationId = input.activeConversationId
  let currentConversation: ConversationRecord | null = null

  if (conversationId) {
    currentConversation = await window.tidecodeHistory.getConversation(conversationId)
  } else {
    const createdConversation = await window.tidecodeHistory.createConversation({
      chatMode: input.chatMode,
      ...(input.compactionSourceConversationId
        ? { compactionSourceConversationId: input.compactionSourceConversationId }
        : {}),
      folderId: input.selectedFolderId,
    })
    conversationId = createdConversation.id
    currentConversation = createdConversation
  }

  if (!currentConversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  const shouldUpdateTitle = currentConversation.messages.length === 0
  const runCheckpoint = await createRunCheckpoint(currentConversation.agentContextRootPath)
  const userMessages = normalizedMessages.map((message) =>
    buildUserMessage(
      message.text,
      input.modelId,
      input.providerId,
      input.reasoningEffort,
      message.attachments,
      runCheckpoint,
      input.chatMode,
    ),
  )
  const userMessage = userMessages[0]
  if (!userMessage) {
    throw new Error('Cannot persist an empty user message batch.')
  }
  const conversation = await window.tidecodeHistory.appendMessages({
    chatMode: input.chatMode,
    conversationId,
    messages: userMessages,
    title: shouldUpdateTitle
      ? input.title?.trim() || getConversationTitleFromInput(userMessage.content, userMessage.attachments ?? [])
      : undefined,
  })

  return {
    conversation,
    userMessage,
  }
}

export async function persistAssistantTurn(conversationId: string, messages: Message[]) {
  return window.tidecodeHistory.appendMessages({
    conversationId,
    messages,
  })
}

export async function persistConversationSnapshot(
  conversationId: string,
  messages: Message[],
  options: { synchronizeCanonicalHistory?: boolean } = {},
) {
  return window.tidecodeHistory.replaceMessages({
    conversationId,
    messages,
    synchronizeCanonicalHistory: options.synchronizeCanonicalHistory,
  })
}

export function getMessagesBeforeUserMessage(messages: readonly Message[], messageId: string) {
  const targetMessageIndex = messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )
  return targetMessageIndex < 0 ? null : messages.slice(0, targetMessageIndex)
}

export function getMessagesThroughUserMessage(messages: readonly Message[], messageId: string) {
  const targetMessageIndex = messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )
  return targetMessageIndex < 0 ? null : messages.slice(0, targetMessageIndex + 1)
}

export async function rollbackConversationBeforeUserMessage(conversationId: string, messageId: string) {
  const conversation = await loadStoredConversationOrThrow(conversationId)
  const messagesBeforeUserMessage = getMessagesBeforeUserMessage(conversation.messages, messageId)
  if (!messagesBeforeUserMessage) {
    return conversation
  }

  return persistConversationSnapshot(conversationId, messagesBeforeUserMessage, {
    synchronizeCanonicalHistory: true,
  })
}

export async function restoreWorkspaceCheckpointForMessage(conversationId: string, messageId: string) {
  const conversation = await loadStoredConversationOrThrow(conversationId)
  const { checkpointIds, targetMessage, targetMessageIndex } = await findUserMessageForRevertOrThrow(conversation, messageId)

  await restoreWorkspaceCheckpointSequence(checkpointIds)
  return {
    conversation,
    targetMessage,
    targetMessageIndex,
  }
}

export async function restoreWorkspaceCheckpointSequence(checkpointIds: readonly string[]) {
  await window.tidecodeWorkspace.restoreCheckpointSequence([...checkpointIds])
}

export async function prepareRevertSessionForMessage(
  conversationId: string,
  messageId: string,
): Promise<RevertPreparationResult> {
  const conversation = await loadStoredConversationOrThrow(conversationId)
  const { checkpointIds, targetMessage, targetMessageIndex } = await findUserMessageForRevertOrThrow(conversation, messageId)
  const redoCheckpoint = await window.tidecodeWorkspace.createRedoCheckpointFromSources(checkpointIds)

  return {
    checkpointIds,
    messageId: targetMessage.id,
    redoCheckpointId: redoCheckpoint.id,
    revertedChatMode: resolveRevertedChatMode(conversation, targetMessageIndex),
  }
}
