import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getVirtualAgentContextDirectoryName } from './virtualAgentContext'

const HISTORY_ROOT_SEGMENTS = ['.echosphere', 'history'] as const
const AGENT_CONTEXTS_DIRECTORY_NAME = 'agent-contexts'

export const MESSAGE_LOG_FILE_NAME = 'messages.jsonl'
export const FOLDERS_FILE_NAME = 'folders.json'

export function getHistoryDirectoryPath() {
  return path.join(app.getPath('home'), ...HISTORY_ROOT_SEGMENTS)
}

export function getConversationFilePath(conversationId: string) {
  return path.join(getHistoryDirectoryPath(), `${conversationId}.json`)
}

export function getMessageLogPath() {
  return path.join(getHistoryDirectoryPath(), MESSAGE_LOG_FILE_NAME)
}

export function getFoldersFilePath() {
  return path.join(getHistoryDirectoryPath(), FOLDERS_FILE_NAME)
}

export function getAgentContextsDirectoryPath() {
  return path.join(getHistoryDirectoryPath(), AGENT_CONTEXTS_DIRECTORY_NAME)
}

export function getConversationAgentContextPath(conversationId: string) {
  return path.join(getAgentContextsDirectoryPath(), getVirtualAgentContextDirectoryName(conversationId))
}

export function getDraftAgentContextPath() {
  return path.join(getAgentContextsDirectoryPath(), 'VIRT_draft')
}

export async function ensureHistoryDirectory() {
  await fs.mkdir(getHistoryDirectoryPath(), { recursive: true })
}

export async function ensureAgentContextsDirectory() {
  await ensureHistoryDirectory()
  await fs.mkdir(getAgentContextsDirectoryPath(), { recursive: true })
}
