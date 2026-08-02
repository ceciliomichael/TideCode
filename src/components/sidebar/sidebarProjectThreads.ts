import { ARCHIVED_FOLDER_ID, PINNED_FOLDER_ID } from '../../hooks/chatHistoryViewModels'
import type { ConversationGroupPreview, ConversationPreview } from '../../types/chat'

export const ALL_PROJECTS_FILTER_ID = 'all-projects'
export const CHATS_PROJECT_FILTER_ID = 'chats'
export const ARCHIVED_PROJECT_FILTER_ID = ARCHIVED_FOLDER_ID
export const UNASSIGNED_WORKSPACE_NAME = 'Chats'

export interface SidebarProjectOption {
  conversationCount: number
  id: string
  name: string
}

export interface SidebarThreadRow {
  conversation: ConversationPreview
  workspaceName: string
}

function isProjectGroup(group: ConversationGroupPreview) {
  return group.folder.id !== null && group.folder.id !== PINNED_FOLDER_ID && group.folder.id !== ARCHIVED_FOLDER_ID
}

export function buildSidebarProjectOptions(
  conversationGroups: readonly ConversationGroupPreview[],
): SidebarProjectOption[] {
  const conversationCounts = new Map<string, number>()

  for (const group of conversationGroups) {
    for (const conversation of group.conversations) {
      if (conversation.folderId === null || conversation.isArchived) {
        continue
      }

      conversationCounts.set(conversation.folderId, (conversationCounts.get(conversation.folderId) ?? 0) + 1)
    }
  }

  return conversationGroups.filter(isProjectGroup).map((group) => ({
    conversationCount: conversationCounts.get(group.folder.id as string) ?? 0,
    id: group.folder.id as string,
    name: group.folder.name,
  }))
}

export function buildSidebarThreadRows(
  conversationGroups: readonly ConversationGroupPreview[],
  selectedProjectId: string,
  searchQuery = '',
): SidebarThreadRow[] {
  const workspaceNames = new Map<string, string>()
  for (const group of conversationGroups) {
    if (isProjectGroup(group)) {
      workspaceNames.set(group.folder.id as string, group.folder.name)
    }
  }

  const conversationsById = new Map<string, ConversationPreview>()
  for (const group of conversationGroups) {
    for (const conversation of group.conversations) {
      conversationsById.set(conversation.id, conversation)
    }
  }

  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()

  return [...conversationsById.values()]
    .filter(
      (conversation) =>
        (selectedProjectId === ALL_PROJECTS_FILTER_ID && !conversation.isArchived) ||
        (selectedProjectId === ARCHIVED_PROJECT_FILTER_ID && conversation.isArchived) ||
        (selectedProjectId === CHATS_PROJECT_FILTER_ID && !conversation.isArchived && conversation.folderId === null) ||
        (selectedProjectId !== ALL_PROJECTS_FILTER_ID &&
          selectedProjectId !== CHATS_PROJECT_FILTER_ID &&
          selectedProjectId !== ARCHIVED_PROJECT_FILTER_ID &&
          !conversation.isArchived &&
          conversation.folderId === selectedProjectId),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((conversation) => ({
      conversation,
      workspaceName:
        conversation.folderId === null
          ? UNASSIGNED_WORKSPACE_NAME
          : (workspaceNames.get(conversation.folderId) ?? UNASSIGNED_WORKSPACE_NAME),
    }))
    .filter(
      ({ conversation, workspaceName }) =>
        normalizedSearchQuery.length === 0 ||
        conversation.title.toLocaleLowerCase().includes(normalizedSearchQuery) ||
        workspaceName.toLocaleLowerCase().includes(normalizedSearchQuery),
    )
}

export function resolveSidebarProjectFilter(
  selectedProjectId: string,
  projects: readonly SidebarProjectOption[],
  isLoading = false,
) {
  if (
    isLoading ||
    selectedProjectId === ALL_PROJECTS_FILTER_ID ||
    selectedProjectId === CHATS_PROJECT_FILTER_ID ||
    selectedProjectId === ARCHIVED_PROJECT_FILTER_ID ||
    projects.some((project) => project.id === selectedProjectId)
  ) {
    return selectedProjectId
  }

  return ALL_PROJECTS_FILTER_ID
}

