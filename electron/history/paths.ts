import { promises as fs } from 'node:fs'
import path from 'node:path'
import { electronApp } from '../electronApp'
import { getVirtualAgentContextDirectoryName } from './virtualAgentContext'

const HISTORY_ROOT_SEGMENTS = ['.tidecode', 'history'] as const
const AGENT_CONTEXTS_DIRECTORY_NAME = 'agent-contexts'
const ATTACHMENTS_DIRECTORY_NAME = 'attachments'

export const MESSAGE_LOG_FILE_NAME = 'messages.jsonl'
export const FOLDERS_FILE_NAME = 'folders.json'

export function getHistoryDirectoryPath() {
  return path.join(electronApp.getPath('home'), ...HISTORY_ROOT_SEGMENTS)
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

export function getAttachmentsDirectoryPath() {
  return path.join(getHistoryDirectoryPath(), ATTACHMENTS_DIRECTORY_NAME)
}

export function getConversationAttachmentsPath(conversationId: string) {
  return path.join(getAttachmentsDirectoryPath(), conversationId.trim())
}

export function getDraftAttachmentsPath(scopeId = 'VIRT_draft') {
  return path.join(getAttachmentsDirectoryPath(), scopeId.trim() || 'VIRT_draft')
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

export async function ensureAttachmentsDirectory() {
  await ensureHistoryDirectory()
  await fs.mkdir(getAttachmentsDirectoryPath(), { recursive: true })
}
