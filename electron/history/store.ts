import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { deleteCanonicalHistory } from '../chat/history/eventStore'
import type {
  AppendConversationMessagesInput,
  ChatMode,
  ConversationRecord,
  CreateConversationFolderInput,
  RenameConversationFolderInput,
  ReplaceConversationMessagesInput,
  CreateConversationInput,
  FolderMoveDirection,
  ReorderConversationFolderInput,
} from '../../src/types/chat'
import {
  appendMessagesToLog,
  deleteConversationFile,
  listConversationRecords,
  readUserMessageCheckpointHistory,
  readConversationFile,
  writeConversationFile,
} from './conversationFileStore'
import { buildConversationSummary } from './documents'
import {
  ensureStoredFolderExists,
  readPrunedFolderStore,
  toFolderSummaries,
  writeFolderStore,
} from './folderStore'
import { buildConversationCompaction } from './conversationCompaction'
import { getConversationAgentContextPath, getDraftAgentContextPath } from './paths'

export async function ensureDraftAgentContextDirectory() {
  const draftPath = getDraftAgentContextPath()
  await fs.mkdir(draftPath, { recursive: true })
  return draftPath
}

export async function cleanupDraftAgentContextDirectory() {
  const draftPath = getDraftAgentContextPath()
  try {
    await fs.rm(draftPath, { recursive: true, force: true })
    await fs.mkdir(draftPath, { recursive: true })
  } catch (error) {
    console.warn('Failed to cleanup draft virtual agent context directory', error)
  }
}

export async function adoptDraftAgentContextDirectory(targetConversationId: string) {
  const draftPath = getDraftAgentContextPath()
  const targetPath = getConversationAgentContextPath(targetConversationId)

  try {
    await fs.mkdir(targetPath, { recursive: true })
    const entries = await fs.readdir(draftPath, { withFileTypes: true })
    for (const entry of entries) {
      const src = path.join(draftPath, entry.name)
      const dest = path.join(targetPath, entry.name)
      await fs.cp(src, dest, { recursive: true })
    }
  } catch (error) {
    // Draft directory might not exist or be empty, which is completely normal
  } finally {
    await cleanupDraftAgentContextDirectory()
  }

  return targetPath
}

async function ensureVirtualAgentContextDirectory(conversationId: string) {
  const agentContextPath = getConversationAgentContextPath(conversationId)
  await fs.mkdir(agentContextPath, { recursive: true })
  return agentContextPath
}

async function resolveAgentContextRootPath(conversationId: string, folderId: string | null, chatMode: ChatMode) {
  if (chatMode !== 'agent' && chatMode !== 'plan') {
    return ensureVirtualAgentContextDirectory(conversationId)
  }

  try {
    const matchedFolder = await ensureStoredFolderExists(folderId)
    if (matchedFolder?.path.trim()) {
      return matchedFolder.path.trim()
    }
  } catch (error) {
    console.warn(`Falling back to a virtual agent context for conversation ${conversationId}`, error)
  }

  return ensureVirtualAgentContextDirectory(conversationId)
}

async function ensureConversationAgentContext(conversation: ConversationRecord) {
  const chatMode = conversation.chatMode ?? 'agent'
  const agentContextRootPath =
    conversation.agentContextRootPath.trim().length > 0
      ? conversation.agentContextRootPath.trim()
      : await resolveAgentContextRootPath(conversation.id, conversation.folderId, chatMode)

  if (conversation.chatMode === chatMode && conversation.agentContextRootPath === agentContextRootPath) {
    return conversation
  }

  const nextConversation: ConversationRecord = {
    ...conversation,
    agentContextRootPath,
    chatMode,
  }

  await writeConversationFile(nextConversation)
  return nextConversation
}

export async function listStoredConversations() {
  const conversations = await listConversationRecords()
  const hydratedConversations = await Promise.all(conversations.map((conversation) => ensureConversationAgentContext(conversation)))
  return hydratedConversations
    .filter((conversation) => conversation.messages.length > 0)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((conversation) => buildConversationSummary(conversation))
}

export async function listStoredFolders() {
  return toFolderSummaries(await readPrunedFolderStore())
}

export async function moveStoredFolder(folderId: string, direction: FolderMoveDirection) {
  const folders = await readPrunedFolderStore()
  const currentIndex = folders.findIndex((folder) => folder.id === folderId)

  if (currentIndex < 0) {
    throw new Error(`Folder not found: ${folderId}`)
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (targetIndex < 0 || targetIndex >= folders.length) {
    return folders[currentIndex]
  }

  const nextFolders = [...folders]
  const [movedFolder] = nextFolders.splice(currentIndex, 1)
  const updatedFolder = {
    ...movedFolder,
    updatedAt: Date.now(),
  }
  nextFolders.splice(targetIndex, 0, updatedFolder)

  await writeFolderStore(nextFolders)
  return updatedFolder
}

export async function reorderStoredFolder(input: ReorderConversationFolderInput) {
  const { folderId, targetFolderId, position } = input
  const folders = await readPrunedFolderStore()

  if (folderId === targetFolderId) {
    const matchedFolder = folders.find((folder) => folder.id === folderId)
    if (!matchedFolder) {
      throw new Error(`Folder not found: ${folderId}`)
    }

    return matchedFolder
  }

  const currentIndex = folders.findIndex((folder) => folder.id === folderId)
  const targetIndex = folders.findIndex((folder) => folder.id === targetFolderId)
  if (currentIndex < 0) {
    throw new Error(`Folder not found: ${folderId}`)
  }
  if (targetIndex < 0) {
    throw new Error(`Target folder not found: ${targetFolderId}`)
  }

  const nextFolders = [...folders]
  const [movedFolder] = nextFolders.splice(currentIndex, 1)
  const updatedFolder = {
    ...movedFolder,
    updatedAt: Date.now(),
  }

  const nextTargetIndex = nextFolders.findIndex((folder) => folder.id === targetFolderId)
  if (nextTargetIndex < 0) {
    throw new Error(`Target folder not found after reorder prep: ${targetFolderId}`)
  }

  const insertIndex = position === 'after' ? nextTargetIndex + 1 : nextTargetIndex
  nextFolders.splice(insertIndex, 0, updatedFolder)

  await writeFolderStore(nextFolders)
  return updatedFolder
}

export async function getStoredConversation(conversationId: string) {
  try {
    const conversation = await readConversationFile(conversationId)
    return ensureConversationAgentContext(conversation)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    console.error(`Failed to load conversation: ${conversationId}`, error)
    throw error
  }
}

export async function getStoredUserMessageCheckpointHistory(conversationId: string, messageId: string) {
  return readUserMessageCheckpointHistory(conversationId, messageId)
}

export async function createStoredConversation(input?: CreateConversationInput) {
  const timestamp = Date.now()
  const compactionSourceConversationId = input?.compactionSourceConversationId?.trim() ?? ''
  const sourceConversation = compactionSourceConversationId
    ? await getStoredConversation(compactionSourceConversationId)
    : null
  if (compactionSourceConversationId && !sourceConversation) {
    throw new Error('The chat selected for compression no longer exists.')
  }

  const folderId = sourceConversation?.folderId ?? input?.folderId ?? null
  const chatMode = input?.chatMode ?? sourceConversation?.chatMode ?? 'agent'

  const conversationId = randomUUID()
  const agentContextRootPath =
    sourceConversation?.agentContextRootPath ??
    (await resolveAgentContextRootPath(conversationId, folderId, chatMode))

  if (!folderId) {
    await adoptDraftAgentContextDirectory(conversationId)
  }
  const compaction = sourceConversation
    ? buildConversationCompaction(sourceConversation, await listConversationRecords(), timestamp)
    : undefined

  const conversation: ConversationRecord = {
    agentContextRootPath,
    chatMode,
    ...(compaction ? { compaction } : {}),
    id: conversationId,
    title: 'New chat',
    createdAt: timestamp,
    updatedAt: timestamp,
    folderId,
    messages: [],
  }

  await writeConversationFile(conversation)
  return conversation
}

export async function createStoredFolder(input: CreateConversationFolderInput) {
  const name = input.name.trim()
  const folderPath = input.path.trim()

  if (name.length === 0) {
    throw new Error('Folder name is required.')
  }

  if (folderPath.length === 0) {
    throw new Error('Folder path is required.')
  }

  const folderStats = await fs.stat(folderPath)
  if (!folderStats.isDirectory()) {
    throw new Error(`Folder path is not a directory: ${folderPath}`)
  }

  if (name.length > 48) {
    throw new Error('Folder name must be 48 characters or less.')
  }

  const folders = await readPrunedFolderStore()
  const duplicateFolder = folders.find(
    (folder) => folder.path.localeCompare(folderPath, undefined, { sensitivity: 'base' }) === 0,
  )
  if (duplicateFolder) {
    throw new Error(`Folder already exists: ${folderPath}`)
  }

  const timestamp = Date.now()
  const nextFolder = {
    id: randomUUID(),
    name,
    path: folderPath,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await writeFolderStore([...folders, nextFolder])
  return nextFolder
}

export async function createStoredFolderFromPath(folderPath: string) {
  const normalizedFolderPath = folderPath.trim()
  if (normalizedFolderPath.length === 0) {
    throw new Error('Folder path is required.')
  }

  return createStoredFolder({
    name: path.basename(normalizedFolderPath),
    path: normalizedFolderPath,
  })
}

export async function renameStoredFolder(input: RenameConversationFolderInput) {
  const nextName = input.name.trim()
  if (nextName.length === 0) {
    throw new Error('Folder name is required.')
  }

  if (nextName.length > 48) {
    throw new Error('Folder name must be 48 characters or less.')
  }

  const folders = await readPrunedFolderStore()
  const folderToRename = folders.find((folder) => folder.id === input.folderId)
  if (!folderToRename) {
    throw new Error(`Folder not found: ${input.folderId}`)
  }

  if (folderToRename.name === nextName) {
    return folderToRename
  }

  const updatedFolder = {
    ...folderToRename,
    name: nextName,
    updatedAt: Date.now(),
  }
  const nextFolders = folders.map((folder) => (folder.id === input.folderId ? updatedFolder : folder))
  await writeFolderStore(nextFolders)
  return updatedFolder
}

export async function deleteStoredFolder(folderId: string) {
  const folders = await readPrunedFolderStore()
  const hasFolder = folders.some((folder) => folder.id === folderId)
  if (!hasFolder) {
    return []
  }

  const nextFolders = folders.filter((folder) => folder.id !== folderId)
  const conversations = await listConversationRecords()
  const conversationsToDelete = conversations.filter((conversation) => conversation.folderId === folderId)
  const deletedConversationIds = conversationsToDelete.map((conversation) => conversation.id)

  await Promise.all([
    writeFolderStore(nextFolders),
    ...deletedConversationIds.map((conversationId) => deleteConversationFile(conversationId)),
    ...deletedConversationIds.map((conversationId) => deleteCanonicalHistory(conversationId)),
  ])

  return deletedConversationIds
}

export async function appendStoredMessages(input: AppendConversationMessagesInput) {
  const existingConversation = await getStoredConversation(input.conversationId)

  if (!existingConversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`)
  }

  const existingMessageIds = new Set(existingConversation.messages.map((message) => message.id))
  const uniqueMessages = input.messages.filter((message) => !existingMessageIds.has(message.id))

  const nextTitle = input.title?.trim() ? input.title.trim() : existingConversation.title
  const hasTitleChange = nextTitle !== existingConversation.title

  if (uniqueMessages.length === 0 && !hasTitleChange) {
    return existingConversation
  }

  const nextConversation: ConversationRecord = {
    ...existingConversation,
    chatMode: input.chatMode ?? existingConversation.chatMode,
    title: nextTitle,
    updatedAt:
      uniqueMessages.at(-1)?.timestamp ?? (hasTitleChange ? Date.now() : existingConversation.updatedAt),
    messages: uniqueMessages.length === 0 ? existingConversation.messages : [...existingConversation.messages, ...uniqueMessages],
  }

  await Promise.all([
    writeConversationFile(nextConversation),
    appendMessagesToLog(input.conversationId, uniqueMessages),
  ])

  return nextConversation
}

export async function replaceStoredMessages(input: ReplaceConversationMessagesInput) {
  const existingConversation = await getStoredConversation(input.conversationId)

  if (!existingConversation) {
    throw new Error(`Conversation not found: ${input.conversationId}`)
  }

  const existingMessagesById = new Map(existingConversation.messages.map((message) => [message.id, message]))
  const messagesToLog = input.messages.filter((message) => {
    const existingMessage = existingMessagesById.get(message.id)
    if (!existingMessage) {
      return true
    }

    return (
      message.role === 'user' &&
      message.runCheckpoint?.id !== undefined &&
      message.runCheckpoint.id !== existingMessage.runCheckpoint?.id
    )
  })

  const nextConversation: ConversationRecord = {
    ...existingConversation,
    chatMode: input.chatMode ?? existingConversation.chatMode,
    title: input.title?.trim() ? input.title.trim() : existingConversation.title,
    updatedAt: input.messages.at(-1)?.timestamp ?? Date.now(),
    messages: input.messages,
  }

  await Promise.all([
    writeConversationFile(nextConversation),
    appendMessagesToLog(input.conversationId, messagesToLog),
  ])

  return nextConversation
}

export async function updateStoredConversationTitle(conversationId: string, title: string) {
  const existingConversation = await getStoredConversation(conversationId)

  if (!existingConversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  const nextTitle = title.trim()
  if (nextTitle.length === 0) {
    return existingConversation
  }

  const boundedTitle = nextTitle.length > 120 ? nextTitle.slice(0, 120) : nextTitle
  if (boundedTitle === existingConversation.title) {
    return existingConversation
  }

  const nextConversation: ConversationRecord = {
    ...existingConversation,
    title: boundedTitle,
    updatedAt: Date.now(),
  }

  await writeConversationFile(nextConversation)
  return nextConversation
}

export async function updateStoredConversationPinned(conversationId: string, isPinned: boolean) {
  const existingConversation = await getStoredConversation(conversationId)

  if (!existingConversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  if (Boolean(existingConversation.isPinned) === isPinned) {
    return existingConversation
  }

  const nextConversation: ConversationRecord = {
    ...existingConversation,
    isPinned,
    updatedAt: Date.now(),
  }

  await writeConversationFile(nextConversation)
  return nextConversation
}
export async function deleteStoredConversation(conversationId: string) {
  const conversation = await getStoredConversation(conversationId)
  await deleteConversationFile(conversationId)
  await deleteCanonicalHistory(conversationId)

  const contextOwnerConversationId = conversation?.compaction?.rootConversationId ?? conversationId
  if (
    !conversation ||
    conversation.agentContextRootPath !== getConversationAgentContextPath(contextOwnerConversationId)
  ) {
    return
  }

  const contextIsStillInUse = (await listConversationRecords()).some(
    (remainingConversation) =>
      remainingConversation.id !== conversationId &&
      remainingConversation.agentContextRootPath === conversation.agentContextRootPath,
  )
  if (contextIsStillInUse) {
    return
  }

  try {
    await fs.rm(conversation.agentContextRootPath, { force: true, recursive: true })
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === 'ENOENT') {
      return
    }

    console.warn(`Failed to remove agent context for conversation ${conversationId}`, error)
  }
}
