import { createReadStream, promises as fs } from 'node:fs'
import { createInterface } from 'node:readline'
import type { ConversationRecord, Message, UserMessageRunCheckpoint } from '../../src/types/chat'
import {
  buildConversationSummary,
  createMessageLogPayload,
  type MessageLogEntry,
} from './documents'
import { readConversationRecordFromPath } from './conversationFileReader'
import { mapConversationFiles } from './conversationListing'
import {
  ensureHistoryDirectory,
  getConversationFilePath,
  getHistoryDirectoryPath,
  getMessageLogPath,
} from './paths'
import { writeConversationFileAtomic } from './conversationFileWriter'

const MAX_CACHED_CHECKPOINT_CONVERSATIONS = 128
const userMessageCheckpointHistoryCache = new Map<string, Map<string, UserMessageRunCheckpoint[]>>()

function getCheckpointHistoryCacheForConversation(conversationId: string) {
  const normalizedConversationId = conversationId.trim()
  if (normalizedConversationId.length === 0) {
    return null
  }

  const cachedConversation = userMessageCheckpointHistoryCache.get(normalizedConversationId)
  if (cachedConversation) {
    userMessageCheckpointHistoryCache.delete(normalizedConversationId)
    userMessageCheckpointHistoryCache.set(normalizedConversationId, cachedConversation)
    return cachedConversation
  }

  const nextConversationCache = new Map<string, UserMessageRunCheckpoint[]>()
  userMessageCheckpointHistoryCache.set(normalizedConversationId, nextConversationCache)
  while (userMessageCheckpointHistoryCache.size > MAX_CACHED_CHECKPOINT_CONVERSATIONS) {
    const oldestConversationId = userMessageCheckpointHistoryCache.keys().next().value
    if (typeof oldestConversationId !== 'string') break
    userMessageCheckpointHistoryCache.delete(oldestConversationId)
  }
  return nextConversationCache
}

function updateCachedUserMessageCheckpoints(conversationId: string, messages: Message[]) {
  const conversationCache = getCheckpointHistoryCacheForConversation(conversationId)
  if (!conversationCache) {
    return
  }

  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }

    const checkpoint = message.runCheckpoint
    if (!checkpoint) {
      continue
    }

    const messageId = message.id.trim()
    if (messageId.length === 0) {
      continue
    }

    const existingHistory = conversationCache.get(messageId) ?? []
    if (existingHistory.some((entry) => entry.id === checkpoint.id)) {
      continue
    }

    conversationCache.set(messageId, [...existingHistory, checkpoint])
  }
}

export async function readConversationFile(conversationId: string) {
  return readConversationRecordFromPath(getConversationFilePath(conversationId))
}

export async function writeConversationFile(conversation: ConversationRecord) {
  await ensureHistoryDirectory()
  await writeConversationFileAtomic(getConversationFilePath(conversation.id), JSON.stringify(conversation, null, 2))
}

export async function appendMessagesToLog(conversationId: string, messages: Message[]) {
  if (messages.length === 0) {
    return
  }

  const payload = createMessageLogPayload(conversationId, messages)
  await ensureHistoryDirectory()
  await fs.appendFile(getMessageLogPath(), `${payload}\n`, 'utf8')
  updateCachedUserMessageCheckpoints(conversationId, messages)
}

export async function readUserMessageCheckpointHistory(conversationId: string, messageId: string) {
  const conversationCache = getCheckpointHistoryCacheForConversation(conversationId)
  const normalizedMessageId = messageId.trim()
  if (!conversationCache || normalizedMessageId.length === 0) {
    return []
  }

  const cachedHistory = conversationCache.get(normalizedMessageId)
  if (cachedHistory) {
    return [...cachedHistory].sort((left, right) => left.createdAt - right.createdAt)
  }

  await ensureHistoryDirectory()
  const messageLogPath = getMessageLogPath()
  const stream = createReadStream(messageLogPath, { encoding: 'utf8' })
  const reader = createInterface({
    crlfDelay: Infinity,
    input: stream,
  })
  const checkpoints = new Map<string, UserMessageRunCheckpoint>()

  try {
    for await (const line of reader) {
      const trimmedLine = line.trim()
      if (trimmedLine.length === 0) {
        continue
      }

      let parsedEntry: MessageLogEntry
      try {
        parsedEntry = JSON.parse(trimmedLine) as MessageLogEntry
      } catch {
        continue
      }

      if (
        parsedEntry.conversationId !== conversationId ||
        parsedEntry.message.role !== 'user' ||
        parsedEntry.message.id !== normalizedMessageId
      ) {
        continue
      }

      const checkpoint = parsedEntry.message.runCheckpoint
      if (!checkpoint) {
        continue
      }

      checkpoints.set(checkpoint.id, checkpoint)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }

    throw error
  } finally {
    reader.close()
    stream.destroy()
  }

  const history = Array.from(checkpoints.values()).sort((left, right) => left.createdAt - right.createdAt)
  conversationCache.set(normalizedMessageId, history)
  return [...history]
}

export async function mapStoredConversationFiles<T>(
  transform: (conversation: ConversationRecord) => T | null | Promise<T | null>,
) {
  await ensureHistoryDirectory()
  return mapConversationFiles(getHistoryDirectoryPath(), transform)
}

export async function listConversationSummaries() {
  const summaries = await mapStoredConversationFiles(buildConversationSummary)
  return summaries.sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function listConversationRecords() {
  return mapStoredConversationFiles((conversation) => conversation)
}

export async function deleteConversationFile(conversationId: string) {
  const normalizedConversationId = conversationId.trim()
  if (normalizedConversationId.length > 0) {
    userMessageCheckpointHistoryCache.delete(normalizedConversationId)
  }
  try {
    await ensureHistoryDirectory()
    await fs.unlink(getConversationFilePath(conversationId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    console.error(`Failed to delete conversation: ${conversationId}`, error)
    throw error
  }
}
