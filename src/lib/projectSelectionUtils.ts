import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
} from '../components/sidebar/sidebarProjectThreads'
import type { ConversationGroupPreview } from '../types/chat'

export type ProjectSwitchTargetAction =
  | { type: 'preserve_active_thread' }
  | { type: 'switch_to_conversation'; conversationId: string }
  | { type: 'create_new_conversation'; folderId: string | null | undefined }

export interface ResolveProjectSwitchInput {
  activeConversationId: string | null
  conversationGroups: readonly ConversationGroupPreview[]
  currentSelectedFolderId: string | null
  projectId: string
}

export function resolveProjectSwitchTarget({
  activeConversationId,
  currentSelectedFolderId,
  projectId,
}: ResolveProjectSwitchInput): ProjectSwitchTargetAction {
  if (projectId === ALL_PROJECTS_FILTER_ID) {
    return { type: 'preserve_active_thread' }
  }

  if (projectId === CHATS_PROJECT_FILTER_ID) {
    return { type: 'create_new_conversation', folderId: null }
  }

  if (projectId === ARCHIVED_PROJECT_FILTER_ID) {
    return { type: 'preserve_active_thread' }
  }

  const targetFolderId = projectId

  if (activeConversationId && currentSelectedFolderId === targetFolderId) {
    return { type: 'preserve_active_thread' }
  }

  return { type: 'create_new_conversation', folderId: targetFolderId }
}

export function resolveProjectFilterDraftFolderId(projectId: string): string | null | undefined {
  if (projectId === ALL_PROJECTS_FILTER_ID || projectId === ARCHIVED_PROJECT_FILTER_ID) {
    return undefined
  }

  return projectId === CHATS_PROJECT_FILTER_ID ? null : projectId
}

export function shouldResetProjectFilterToAllProjects(
  selectedProjectId: string,
  activeThreadFolderId: string | null,
): boolean {
  if (selectedProjectId === ALL_PROJECTS_FILTER_ID) {
    return false
  }

  const activeThreadProjectId = activeThreadFolderId === null ? CHATS_PROJECT_FILTER_ID : activeThreadFolderId
  return selectedProjectId !== activeThreadProjectId
}

export function findFolderIdForConversation(
  conversationGroups: readonly ConversationGroupPreview[],
  conversationId: string,
): string | null | undefined {
  for (const group of conversationGroups) {
    const conversation = group.conversations.find((item) => item.id === conversationId)
    if (conversation) {
      return conversation.folderId
    }
  }
  return undefined
}


