import type { AppSettings, AppSettingsSurface } from '../types/chat'

export const APP_SETTINGS_SURFACES = ['desktop', 'web', 'cli'] as const satisfies readonly AppSettingsSurface[]

export const DEFAULT_APP_SETTINGS_SURFACE: AppSettingsSurface = 'desktop'

export function isAppSettingsSurface(value: unknown): value is AppSettingsSurface {
  return typeof value === 'string' && APP_SETTINGS_SURFACES.includes(value as AppSettingsSurface)
}

export function getRendererAppSettingsSurface(): Extract<AppSettingsSurface, 'desktop' | 'web'> {
  return typeof document !== 'undefined' && document.documentElement.dataset.tidecodeRuntime === 'remote-browser'
    ? 'web'
    : 'desktop'
}

/**
 * Settings that describe one client surface rather than the TideCode installation.
 * Each Desktop, Web, and CLI surface receives an independent persisted copy.
 */
export const SURFACE_APP_SETTINGS_KEYS = [
  'appearance',
  'autoDownloadUpdates',
  'checkForUpdatesOnLaunch',
  'chatModelId',
  'chatModelProviderId',
  'chatModelLabel',
  'chatReasoningEffort',
  'agentModelId',
  'agentModelProviderId',
  'agentModelLabel',
  'planModelId',
  'planModelProviderId',
  'planModelLabel',
  'diffPanelWidth',
  'editSessionsByConversation',
  'followUpBehavior',
  'language',
  'lastActiveConversationId',
  'lastActiveDraftFolderId',
  'openEmptyConversationOnLaunch',
  'revertEditSessionsByConversation',
  'sendMessageOnEnter',
  'workspaceFileEditorWordWrap',
  'conversationModelPreferences',
  'sidebarWidth',
  'workspaceEditorWidth',
  'workspaceExplorerWidth',
  'sourceControlSectionOrder',
  'sourceControlSectionOpen',
  'sourceControlSectionSizes',
  'terminalOpenByWorkspace',
  'terminalPanelHeightsByWorkspace',
  'terminalExecutionMode',
  'selectedProjectId',
  'selectedProjectName',
] as const satisfies readonly (keyof AppSettings)[]

export type SurfaceAppSettingsKey = (typeof SURFACE_APP_SETTINGS_KEYS)[number]
export type SurfaceAppSettings = Pick<AppSettings, SurfaceAppSettingsKey>
export type SharedAppSettings = Omit<AppSettings, SurfaceAppSettingsKey>

const SURFACE_APP_SETTINGS_KEY_SET = new Set<keyof AppSettings>(SURFACE_APP_SETTINGS_KEYS)

export function isSurfaceAppSettingsKey(key: keyof AppSettings): key is SurfaceAppSettingsKey {
  return SURFACE_APP_SETTINGS_KEY_SET.has(key)
}

export function hasSurfaceAppSettingsInput(input: Partial<AppSettings>) {
  return Object.keys(input).some((key) => isSurfaceAppSettingsKey(key as keyof AppSettings))
}

export function hasSharedAppSettingsInput(input: Partial<AppSettings>) {
  return Object.keys(input).some((key) => !isSurfaceAppSettingsKey(key as keyof AppSettings))
}

export function pickSurfaceAppSettings(settings: AppSettings): SurfaceAppSettings {
  const surfaceSettings = {} as SurfaceAppSettings
  const writable = surfaceSettings as Record<SurfaceAppSettingsKey, AppSettings[SurfaceAppSettingsKey]>
  for (const key of SURFACE_APP_SETTINGS_KEYS) {
    writable[key] = settings[key] as AppSettings[SurfaceAppSettingsKey]
  }
  return surfaceSettings
}

export function pickSharedAppSettings(settings: AppSettings): SharedAppSettings {
  const sharedSettings: Partial<AppSettings> = { ...settings }
  for (const key of SURFACE_APP_SETTINGS_KEYS) {
    delete sharedSettings[key]
  }
  return sharedSettings as SharedAppSettings
}

export function splitAppSettingsInput(input: Partial<AppSettings>) {
  const sharedInput: Partial<SharedAppSettings> = {}
  const surfaceInput: Partial<SurfaceAppSettings> = {}
  const writableShared = sharedInput as Partial<Record<keyof AppSettings, AppSettings[keyof AppSettings]>>
  const writableSurface = surfaceInput as Partial<Record<keyof AppSettings, AppSettings[keyof AppSettings]>>

  for (const [key, value] of Object.entries(input) as [keyof AppSettings, AppSettings[keyof AppSettings]][]) {
    if (isSurfaceAppSettingsKey(key)) {
      writableSurface[key] = value
    } else {
      writableShared[key] = value
    }
  }

  return { sharedInput, surfaceInput }
}

export function mergeSurfaceAppSettings(sharedSettings: SharedAppSettings, surfaceSettings: SurfaceAppSettings): AppSettings {
  return {
    ...sharedSettings,
    ...surfaceSettings,
  } as AppSettings
}

/**
 * Apply a settings snapshot from another client without replacing this renderer's
 * surface-local preferences. Shared installation settings still converge.
 */
export function preserveLocalSurfaceSettings(remoteSettings: AppSettings, localSettings: AppSettings): AppSettings {
  return mergeSurfaceAppSettings(
    pickSharedAppSettings(remoteSettings),
    pickSurfaceAppSettings(localSettings),
  )
}
