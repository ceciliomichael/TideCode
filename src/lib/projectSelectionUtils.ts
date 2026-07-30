import { ALL_PROJECTS_FILTER_ID, CHATS_PROJECT_FILTER_ID } from '../components/sidebar/sidebarProjectThreads'
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
  conversationGroups,
  currentSelectedFolderId,
  projectId,
}: ResolveProjectSwitchInput): ProjectSwitchTargetAction {
  if (projectId === ALL_PROJECTS_FILTER_ID) {
    return { type: 'preserve_active_thread' }
  }

  if (projectId === CHATS_PROJECT_FILTER_ID) {
    return { type: 'create_new_conversation', folderId: null }
  }

  const targetFolderId = projectId

  if (activeConversationId && currentSelectedFolderId === targetFolderId) {
    return { type: 'preserve_active_thread' }
  }

  const targetGroup = conversationGroups.find((group) => group.folder.id === targetFolderId)
  const targetConv = targetGroup?.conversations[0]

  if (targetConv) {
    return { type: 'switch_to_conversation', conversationId: targetConv.id }
  }

  return { type: 'create_new_conversation', folderId: targetFolderId }
}
