import type { ConversationFolderRecord, ConversationRecord } from '../../src/types/chat'
import { getConversationPreviewContent } from '../../src/lib/chatMessageMetadata'
import { normalizeWorkspaceRootPathForComparison } from '../../src/lib/workspaceRootPathComparison'
import { colors } from './renderer'
import type { SelectItem, SelectSection } from './interactiveSelect'

export interface ResumeConversationItem {
  id: string
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  workspacePath: string
  projectLabel: string
  isArchived: boolean
}

function getWorkspaceName(workspacePath: string): string {
  const segments = workspacePath.trim().replace(/[\\/]+$/u, '').split(/[\\/]+/u)
  return segments.at(-1) || 'workspace'
}

export function getResumeProjectLabel(
  workspacePath: string,
  folders: readonly ConversationFolderRecord[],
): string {
  const normalizedWorkspacePath = normalizeWorkspaceRootPathForComparison(workspacePath)
  const folder = folders.find((candidate) => (
    normalizeWorkspaceRootPathForComparison(candidate.path) === normalizedWorkspacePath
  ))
  return folder?.name.trim() || getWorkspaceName(workspacePath)
}

export function buildResumeConversationItems(
  conversations: readonly ConversationRecord[],
  folders: readonly ConversationFolderRecord[],
): ResumeConversationItem[] {
  return conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title.trim() || 'Untitled Session',
    preview: getConversationPreviewContent(conversation.messages),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    workspacePath: conversation.agentContextRootPath,
    projectLabel: getResumeProjectLabel(conversation.agentContextRootPath, folders),
    isArchived: conversation.isArchived === true,
  }))
}

export function filterResumeConversationItems(
  items: readonly ResumeConversationItem[],
  workspacePath: string,
): ResumeConversationItem[] {
  const normalizedWorkspacePath = normalizeWorkspaceRootPathForComparison(workspacePath)
  return items.filter((item) => (
    normalizeWorkspaceRootPathForComparison(item.workspacePath) === normalizedWorkspacePath
  ))
}

function createResumeItem(
  conversation: ConversationRecord,
  folderById: ReadonlyMap<string, ConversationFolderRecord>,
): SelectItem<string> {
  const folder = conversation.folderId ? folderById.get(conversation.folderId) : null
  const projectLabel = folder ? folder.name || folder.path : 'workspace'

  return {
    value: conversation.id,
    label: conversation.title || 'Untitled Session',
    description: `Updated: ${new Date(conversation.updatedAt).toLocaleString()}`,
    badge: `${colors.brightMagenta}[project: ${projectLabel}]${colors.reset}`,
  }
}

export function buildResumeConversationSections(
  conversations: readonly ConversationRecord[],
  folders: readonly ConversationFolderRecord[],
): SelectSection<string>[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const sortedConversations = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt)

  return [
    {
      emptyMessage: 'No active conversations.',
      items: sortedConversations
        .filter((conversation) => !conversation.isArchived)
        .map((conversation) => createResumeItem(conversation, folderById)),
      label: 'Active',
    },
    {
      emptyMessage: 'No archived conversations.',
      items: sortedConversations
        .filter((conversation) => conversation.isArchived)
        .map((conversation) => createResumeItem(conversation, folderById)),
      label: 'Archived',
    },
  ]
}
