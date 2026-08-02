import type { AppSettings } from '../types/chat'
import { DEFAULT_APP_APPEARANCE, DEFAULT_APP_LANGUAGE, DEFAULT_FOLLOW_UP_BEHAVIOR } from './appSettings'
import { DEFAULT_DIFF_PANEL_WIDTH } from './diffPanelSizing'
import { DEFAULT_SIDEBAR_WIDTH } from './sidebarSizing'
import { DEFAULT_WORKSPACE_EDITOR_WIDTH } from './workspaceEditorSizing'
import { DEFAULT_WORKSPACE_EXPLORER_WIDTH } from './workspaceExplorerSizing'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from './contextCompactionSettings'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: DEFAULT_APP_APPEARANCE,
  autoDownloadUpdates: false,
  chatModelId: '',
  chatModelProviderId: null,
  chatModelLabel: '',
  chatReasoningEffort: 'medium',
  contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
  agentModelId: '',
  agentModelProviderId: null,
  agentModelLabel: '',
  planModelId: '',
  planModelProviderId: null,
  planModelLabel: '',
  summarizationModelId: '',
  summarizationModelProviderId: null,
  summarizationModelLabel: '',
  gitCommitModelId: '',
  gitCommitModelProviderId: null,
  gitCommitModelLabel: '',
  kanbanAiPlanningEnabled: true,
  kanbanModelId: '',
  kanbanModelProviderId: null,
  kanbanModelLabel: '',
  diffPanelWidth: DEFAULT_DIFF_PANEL_WIDTH,
  editSessionsByConversation: {},
  followUpBehavior: DEFAULT_FOLLOW_UP_BEHAVIOR,
  language: DEFAULT_APP_LANGUAGE,
  lastActiveConversationId: null,
  lastActiveDraftFolderId: null,
  openEmptyConversationOnLaunch: false,
  revertEditSessionsByConversation: {},
  sendMessageOnEnter: true,
  workspaceFileEditorWordWrap: true,
  conversationModelPreferences: {},
  disabledSkillsByPath: {},
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,

  workspaceEditorWidth: DEFAULT_WORKSPACE_EDITOR_WIDTH,
  workspaceExplorerWidth: DEFAULT_WORKSPACE_EXPLORER_WIDTH,
  sourceControlSectionOrder: ['commit', 'changes', 'history'],
  sourceControlSectionOpen: {
    changes: true,
    commit: true,
    history: true,
    staged: true,
    unstaged: true,
  },
  sourceControlSectionSizes: {
    changes: 1,
    commit: 1,
    history: 1,
  },
  terminalOpenByWorkspace: {},
  terminalPanelHeightsByWorkspace: {},
  terminalExecutionMode: 'sandbox',
  selectedProjectId: 'all-projects',
  modelToggleState: {},
}
