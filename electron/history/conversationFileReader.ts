import { promises as fs } from 'node:fs'
import type { ConversationRecord } from '../../src/types/chat'
import { normalizeConversationRecord } from './documents'

const BACKUP_FILE_SUFFIX = '.bak'
const CONVERSATION_FILE_READ_RETRY_DELAY_MS = 25

function getBackupConversationFilePath(filePath: string) {
  return `${filePath}.bak`
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

async function readConversationFileExact(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8')
  if (raw.trim().length === 0) {
    throw new SyntaxError(`Conversation file is empty: ${filePath}`)
  }

  return normalizeConversationRecord(JSON.parse(raw) as Partial<ConversationRecord> & { id: string })
}

async function readConversationFileWithRetry(filePath: string) {
  try {
    return await readConversationFileExact(filePath)
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error
    }

    await sleep(CONVERSATION_FILE_READ_RETRY_DELAY_MS)
    return readConversationFileExact(filePath)
  }
}

export async function readConversationRecordFromPath(filePath: string) {
  try {
    return await readConversationFileWithRetry(filePath)
  } catch (error) {
    const errno = error as NodeJS.ErrnoException
    const shouldTryBackup = (errno.code === 'ENOENT' || error instanceof SyntaxError) && !filePath.endsWith(BACKUP_FILE_SUFFIX)
    if (!shouldTryBackup) {
      throw error
    }

    return readConversationFileWithRetry(getBackupConversationFilePath(filePath))
  }
}
