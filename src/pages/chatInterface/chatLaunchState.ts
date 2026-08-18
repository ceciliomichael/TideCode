import { ALL_PROJECTS_FILTER_ID, ARCHIVED_PROJECT_FILTER_ID, CHATS_PROJECT_FILTER_ID } from '../../components/sidebar/sidebarProjectThreads'
import type { AppSettings } from '../../types/chat'

export interface BootConversationLaunchState {
  preferredDraftFolderId: string | null
  preferredDraftFolderName: string | null
  preferredConversationId: string | null
  openEmptyConversationOnLaunch: boolean
}

function isProjectFilter(projectId: string | undefined): projectId is string {
  return Boolean(
    projectId &&
      projectId !== ALL_PROJECTS_FILTER_ID &&
      projectId !== CHATS_PROJECT_FILTER_ID &&
      projectId !== ARCHIVED_PROJECT_FILTER_ID,
  )
}

export function resolveBootConversationLaunchState(settings: AppSettings): BootConversationLaunchState {
  const selectedProjectId = settings.selectedProjectId
  const preferredDraftFolderId =
    settings.lastActiveDraftFolderId ?? (isProjectFilter(selectedProjectId) ? selectedProjectId : null)
  const selectedProjectName = settings.selectedProjectName?.trim() || null

  return {
    preferredDraftFolderId,
    preferredDraftFolderName:
      preferredDraftFolderId !== null && preferredDraftFolderId === selectedProjectId ? selectedProjectName : null,
    preferredConversationId: settings.lastActiveConversationId,
    openEmptyConversationOnLaunch: settings.openEmptyConversationOnLaunch,
  }
}
