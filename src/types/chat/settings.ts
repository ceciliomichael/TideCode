import type { AppAppearance, AppLanguage, FollowUpBehavior } from '../../lib/appSettings'
import type { ContextCompactionSettings } from '../../lib/contextCompactionSettings'
import type { ChatMode } from './conversations'
import type { ChatProviderId, ReasoningEffort } from './providers'

export type SourceControlSectionId = 'commit' | 'changes' | 'history'
export type SourceControlSectionOpenId = SourceControlSectionId | 'staged' | 'unstaged'
export type AppTerminalExecutionMode = 'full' | 'sandbox'

export interface ConversationEditSession {
  messageId: string
}

export interface RevertEditSession {
  messageId: string
  redoCheckpointId: string
}

export interface ConversationModelPreference {
  chatMode?: ChatMode
  label: string
  modelId: string
  providerId: ChatProviderId | null
  reasoningEffort?: ReasoningEffort
}

export interface AppSettings {
  appearance: AppAppearance
  autoDownloadUpdates: boolean
  chatModelId: string
  chatModelProviderId: ChatProviderId | null
  chatModelLabel: string
  chatReasoningEffort: ReasoningEffort
  contextCompaction: ContextCompactionSettings
  agentModelId: string
  agentModelProviderId: ChatProviderId | null
  agentModelLabel: string
  planModelId: string
  planModelProviderId: ChatProviderId | null
  planModelLabel: string
  summarizationModelId: string
  summarizationModelProviderId: ChatProviderId | null
  summarizationModelLabel: string
  gitCommitModelId: string
  gitCommitModelProviderId: ChatProviderId | null
  gitCommitModelLabel: string
  kanbanAiPlanningEnabled: boolean
  kanbanModelId: string
  kanbanModelProviderId: ChatProviderId | null
  kanbanModelLabel: string
  diffPanelWidth: number
  editSessionsByConversation: Record<string, ConversationEditSession>
  followUpBehavior: FollowUpBehavior
  language: AppLanguage
  lastActiveConversationId: string | null
  lastActiveDraftFolderId: string | null
  openEmptyConversationOnLaunch: boolean
  revertEditSessionsByConversation: Record<string, RevertEditSession>
  sendMessageOnEnter: boolean
  workspaceFileEditorWordWrap: boolean
  conversationModelPreferences: Record<string, ConversationModelPreference>
  disabledSkillsByPath: Record<string, boolean>
  sidebarWidth: number
  workspaceEditorWidth: number
  workspaceExplorerWidth: number
  sourceControlSectionOrder: SourceControlSectionId[]
  sourceControlSectionOpen: Record<SourceControlSectionOpenId, boolean>
  sourceControlSectionSizes: Record<SourceControlSectionId, number>
  terminalOpenByWorkspace: Record<string, boolean>
  terminalPanelHeightsByWorkspace: Record<string, number>
  terminalExecutionMode: AppTerminalExecutionMode
  selectedProjectId?: string
  modelToggleState?: Record<string, boolean>
}
