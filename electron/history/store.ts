import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { deleteCanonicalHistory, synchronizeCanonicalMessages } from '../chat/history/eventStore'
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
  readFolderStore,
  readPrunedFolderStore,
  toFolderSummaries,
  writeFolderStore,
} from './folderStore'
import { buildConversationCompaction } from './conversationCompaction'
import {
  adoptDraftAgentContextDirectory,
  cleanupDraftAgentContextDirectory,
  ensureDraftAgentContextDirectory,
} from './draftAgentContextStore'
import { runConversationMutation } from './conversationMutationQueue'
import { getConversationAgentContextPath } from './paths'

export { cleanupDraftAgentContextDirectory, ensureDraftAgentContextDirectory }

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

async function hydrateConversationAgentContext(conversation: ConversationRecord) {
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

async function ensureConversationAgentContext(conversation: ConversationRecord) {
  return runConversationMutation(conversation.id, () => hydrateConversationAgentContext(conversation))
}

async function readConversationForMutation(conversationId: string) {
  try {
    return await hydrateConversationAgentContext(await readConversationFile(conversationId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
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
  return runConversationMutation(conversationId, async () => {
    try {
      return await readConversationForMutation(conversationId)
    } catch (error) {
      console.error(`Failed to load conversation: ${conversationId}`, error)
      throw error
    }
  })
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

function normalizeStoredFolderPathForComparison(folderPath: string) {
  const resolvedFolderPath = path.resolve(folderPath.trim())
  return process.platform === 'win32' ? resolvedFolderPath.toLowerCase() : resolvedFolderPath
}

export async function ensureStoredFolderFromPath(folderPath: string) {
  const normalizedFolderPath = folderPath.trim()
  if (normalizedFolderPath.length === 0) {
    throw new Error('Folder path is required.')
  }

  const comparisonPath = normalizeStoredFolderPathForComparison(normalizedFolderPath)
  const findExistingFolder = async () =>
    (await readPrunedFolderStore()).find(
      (folder) => normalizeStoredFolderPathForComparison(folder.path) === comparisonPath,
    ) ?? null

  const existingFolder = await findExistingFolder()
  if (existingFolder) return existingFolder

  try {
    return await createStoredFolderFromPath(normalizedFolderPath)
  } catch (error) {
    const racedFolder = await findExistingFolder()
    if (racedFolder) return racedFolder
    throw error
  }
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
  const folders = await readFolderStore()
  const hasFolder = folders.some((folder) => folder.id === folderId)
  const nextFolders = folders.filter((folder) => folder.id !== folderId)
  const conversations = await listConversationRecords()
  const conversationsToDelete = conversations.filter((conversation) => conversation.folderId === folderId)
  const deletedConversationIds = conversationsToDelete.map((conversation) => conversation.id)

  if (!hasFolder && deletedConversationIds.length === 0) {
    return []
  }

  await Promise.all([
    ...(hasFolder ? [writeFolderStore(nextFolders)] : []),
    ...deletedConversationIds.map((conversationId) => runConversationMutation(conversationId, async () => {
      await deleteConversationFile(conversationId)
      await deleteCanonicalHistory(conversationId)
    })),
  ])

  return deletedConversationIds
}

export async function appendStoredMessages(input: AppendConversationMessagesInput) {
  return runConversationMutation(input.conversationId, async () => {
    const existingConversation = await readConversationForMutation(input.conversationId)

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
      isArchived: uniqueMessages.length > 0 ? false : existingConversation.isArchived,
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
  })
}

export async function replaceStoredMessages(input: ReplaceConversationMessagesInput) {
  return runConversationMutation(input.conversationId, async () => {
    const existingConversation = await readConversationForMutation(input.conversationId)

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
      isArchived: false,
      title: input.title?.trim() ? input.title.trim() : existingConversation.title,
      updatedAt: input.messages.at(-1)?.timestamp ?? Date.now(),
      messages: input.messages,
    }

    await Promise.all([
      writeConversationFile(nextConversation),
      appendMessagesToLog(input.conversationId, messagesToLog),
    ])

    if (input.synchronizeCanonicalHistory) {
      try {
        await synchronizeCanonicalMessages(input.conversationId, input.messages)
      } catch (error) {
        console.error('Canonical chat history synchronization failed after message replacement.', error)
      }
    }

    return nextConversation
  })
}

export async function updateStoredConversationChatMode(conversationId: string, chatMode: ChatMode) {
  return runConversationMutation(conversationId, async () => {
    const existingConversation = await readConversationForMutation(conversationId)
    if (!existingConversation) return null
    if (existingConversation.chatMode === chatMode) return existingConversation

    const nextConversation: ConversationRecord = {
      ...existingConversation,
      chatMode,
      updatedAt: existingConversation.updatedAt,
    }
    await writeConversationFile(nextConversation)
    return nextConversation
  })
}

export async function updateStoredConversationTitle(conversationId: string, title: string) {
  return runConversationMutation(conversationId, async () => {
    const existingConversation = await readConversationForMutation(conversationId)

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
  })
}

export async function updateStoredConversationArchived(conversationId: string, isArchived: boolean) {
  return runConversationMutation(conversationId, async () => {
    const existingConversation = await readConversationForMutation(conversationId)

    if (!existingConversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    const nextIsArchived = Boolean(isArchived)
    if (Boolean(existingConversation.isArchived) === nextIsArchived) {
      return existingConversation
    }

    const nextConversation: ConversationRecord = {
      ...existingConversation,
      isArchived: nextIsArchived,
      isPinned: nextIsArchived ? false : existingConversation.isPinned,
      // Archiving changes where the conversation appears, not when it was
      // last used. Keeping this timestamp stable preserves the row's "ago"
      // value across the Active and Archived pages.
      updatedAt: existingConversation.updatedAt,
    }

    await writeConversationFile(nextConversation)
    return nextConversation
  })
}

export async function updateStoredConversationPinned(conversationId: string, isPinned: boolean) {
  return runConversationMutation(conversationId, async () => {
    const existingConversation = await readConversationForMutation(conversationId)

    if (!existingConversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    if (existingConversation.isArchived || Boolean(existingConversation.isPinned) === isPinned) {
      return existingConversation
    }

    const nextConversation: ConversationRecord = {
      ...existingConversation,
      isPinned,
      updatedAt: Date.now(),
    }

    await writeConversationFile(nextConversation)
    return nextConversation
  })
}
export async function deleteStoredConversation(conversationId: string) {
  const conversation = await runConversationMutation(conversationId, async () => {
    const existingConversation = await readConversationForMutation(conversationId)
    await deleteConversationFile(conversationId)
    await deleteCanonicalHistory(conversationId)
    return existingConversation
  })

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
