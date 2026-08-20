import type { AppSettings } from '../types/chat'

export const WORKSPACE_UI_SETTINGS_KEYS = [
  'conversationModelPreferences',
  'diffPanelWidth',
  'editSessionsByConversation',
  'lastActiveConversationId',
  'lastActiveDraftFolderId',
  'openEmptyConversationOnLaunch',
  'revertEditSessionsByConversation',
  'sidebarWidth',
  'workspaceEditorWidth',
  'workspaceExplorerWidth',
  'sourceControlSectionOrder',
  'sourceControlSectionOpen',
  'sourceControlSectionSizes',
  'terminalOpenByWorkspace',
  'terminalPanelHeightsByWorkspace',
  'selectedProjectId',
  'selectedProjectName',
] as const satisfies readonly (keyof AppSettings)[]

const WORKSPACE_UI_SETTINGS_KEY_SET = new Set<keyof AppSettings>(WORKSPACE_UI_SETTINGS_KEYS)

export function hasDurableAppSettingsInput(input: Partial<AppSettings>) {
  return Object.keys(input).some((key) => !WORKSPACE_UI_SETTINGS_KEY_SET.has(key as keyof AppSettings))
}

export function preserveLocalWorkspaceUiSettings(remoteSettings: AppSettings, localSettings: AppSettings): AppSettings {
  const mergedSettings = { ...remoteSettings }
  const writableSettings = mergedSettings as Record<keyof AppSettings, AppSettings[keyof AppSettings]>
  for (const key of WORKSPACE_UI_SETTINGS_KEYS) {
    writableSettings[key] = localSettings[key]
  }
  return mergedSettings
}
