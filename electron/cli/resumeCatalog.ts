import type { ConversationFolderRecord, ConversationRecord } from '../../src/types/chat'
import { colors } from './renderer'
import type { SelectItem, SelectSection } from './interactiveSelect'

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
