import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ConversationRecord } from '../../src/types/chat'
import { readConversationRecordFromPath } from './conversationFileReader'
import { FOLDERS_FILE_NAME, MESSAGE_LOG_FILE_NAME } from './paths'

// Convert each transcript before reading the next batch. A sidebar listing must
// not keep every parsed conversation alive just to return small summaries.
export async function mapConversationFiles<T>(
  directory: string,
  transform: (conversation: ConversationRecord) => T | null | Promise<T | null>,
  readRecord = readConversationRecordFromPath,
): Promise<T[]> {
  const fileNames = await fs.readdir(directory)
  const selectedFiles = new Map<string, string>()
  for (const fileName of fileNames) {
    if (fileName.endsWith('.json') && fileName !== FOLDERS_FILE_NAME && fileName !== MESSAGE_LOG_FILE_NAME) {
      const id = fileName.slice(0, -5)
      if (id) {
        selectedFiles.set(id, fileName)
      }
    }
  }
  for (const fileName of fileNames) {
    if (fileName.endsWith('.json.bak')) {
      const id = fileName.slice(0, -9)
      if (id && !selectedFiles.has(id)) {
        selectedFiles.set(id, fileName)
      }
    }
  }
  const paths = [...selectedFiles.values()]
  const results: T[] = []
  for (let offset = 0; offset < paths.length; offset += 2) {
    const batch = await Promise.all(paths.slice(offset, offset + 2).map(async (fileName) => {
      let conversation: ConversationRecord
      try {
        conversation = await readRecord(path.join(directory, fileName))
      } catch (error) {
        console.error(`Failed to read conversation file: ${fileName}`, error)
        return null
      }
      return transform(conversation)
    }))
    for (const result of batch) {
      if (result !== null) {
        results.push(result)
      }
    }
  }
  return results
}
