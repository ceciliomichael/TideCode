import type { AppAppearance, AppLanguage, FollowUpBehavior } from '../../lib/appSettings'
import type { ContextCompactionSettings } from '../../lib/contextCompactionSettings'
import type { ChatMode } from './conversations'
import type { ChatProviderId, ReasoningEffort } from './providers'

export type SourceControlSectionId = 'commit' | 'changes' | 'history'
export type SourceControlSectionOpenId = SourceControlSectionId | 'staged' | 'unstaged'
export type AppTerminalExecutionMode = 'full' | 'sandbox'
export type AppSettingsSurface = 'desktop' | 'web' | 'cli'
export interface ConversationEditSession {
  messageId: string
}

export interface RevertEditSession {
  chatModeBeforeRevert?: ChatMode
  messageId: string
  redoCheckpointId: string
  revertedChatMode?: ChatMode
  revertedPlanPaths?: string[]
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
  agentReasoningEffort: ReasoningEffort
  planModelId: string
  planModelProviderId: ChatProviderId | null
  planModelLabel: string
  planReasoningEffort: ReasoningEffort
  summarizationModelId: string
  summarizationModelProviderId: ChatProviderId | null
  summarizationModelLabel: string
  summarizationReasoningEffort: ReasoningEffort
  gitCommitModelId: string
  gitCommitModelProviderId: ChatProviderId | null
  gitCommitModelLabel: string
  gitCommitReasoningEffort: ReasoningEffort
  kanbanAiPlanningEnabled: boolean
  kanbanModelId: string
  kanbanModelProviderId: ChatProviderId | null
  kanbanModelLabel: string
  kanbanReasoningEffort: ReasoningEffort
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
  selectedProjectName: string | null
  modelToggleState?: Record<string, boolean>
}
