import { ArrowLeft } from 'lucide-react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { MemoizedGeneralSettingsPanel } from './general/GeneralSettingsPanel'
import { McpServersSettingsPanel } from './mcp/McpServersSettingsPanel'
import { ModelsSettingsPanel } from './models/ModelsSettingsPanel'
import { ProvidersSettingsPanel } from './providers/ProvidersSettingsPanel'
import { SkillsSettingsPanel } from './skills/SkillsSettingsPanel'
import { MemoizedTaskModelsSettingsPanel } from './taskModels/TaskModelsSettingsPanel'
import { RemoteSettingsPanel } from './remote/RemoteSettingsPanel'
import { UpdatesSettingsPanel } from './updates/UpdatesSettingsPanel'
import type { SettingsItemId } from './settingsItems'
import type { AppAppearance, AppLanguage, FollowUpBehavior } from '../../lib/appSettings'
import type { ApiKeyProviderId, AppSettings, ProvidersState, SaveApiKeyProviderInput } from '../../types/chat'
import type { McpAddServerInput, McpState } from '../../types/mcp'
import type { CreateSkillInput, SkillsState } from '../../types/skills'
import type { ContextCompactionSettings } from '../../lib/contextCompactionSettings'
import type { TideCodeSettingsLaunchRequest } from '../../lib/appLaunchRequest'
import { getRendererAppSettingsSurface } from '../../lib/appSettingsScopes'

interface SettingsPanelSlotProps {
  active: boolean
  children: ReactNode
}

function SettingsPanelSlot({ active, children }: SettingsPanelSlotProps) {
  return (
    <div aria-hidden={!active} className="flex w-full justify-center" hidden={!active}>
      {children}
    </div>
  )
}

interface GeneralSettingsViewModel {
  isLoading: boolean
  onUpdateSettings: (input: Partial<AppSettings>) => void
  settings: {
    appearance: AppAppearance
    followUpBehavior: FollowUpBehavior
    language: AppLanguage
    sendMessageOnEnter: boolean
    workspaceFileEditorWordWrap: boolean
  }
}

interface SettingsContentProps {
  activeItemId: SettingsItemId
  appSettings: AppSettings
  onBackToSettings: () => void
  contextSettings: {
    isLoading: boolean
    onUpdateSettings: (input: Partial<AppSettings>) => void
    settings: ContextCompactionSettings
  }
  generalSettings: GeneralSettingsViewModel
  mcpSettings: {
    activeOperation: string | null
    onAddServer: (input: McpAddServerInput) => Promise<boolean>
    errorMessage: string | null
    isLoading: boolean
    onConnectServer: (serverId: string) => Promise<boolean>
    onDisconnectServer: (serverId: string) => Promise<boolean>
    onRemoveServer: (serverId: string) => Promise<boolean>
    onUpdateServer: (serverId: string, input: McpAddServerInput) => Promise<boolean>
    onToggleTool: (serverId: string, toolName: string, enabled: boolean) => Promise<boolean>
    state: McpState | null
  }
  skillsSettings: {
    errorMessage: string | null
    isLoading: boolean
    onCreateSkill: (input: CreateSkillInput) => Promise<boolean>
    onUpdateSettings: (input: Partial<AppSettings>) => void
    settings: Pick<AppSettings, 'disabledSkillsByPath'>
    state: SkillsState | null
  }
  modelsSettings: {
    launchRequest: TideCodeSettingsLaunchRequest | null
    onLaunchRequestHandled: (request: TideCodeSettingsLaunchRequest) => void
    providersState: ProvidersState | null
  }
  providersSettings: {
    activeOperation: string | null
    errorMessage: string | null
    isLoading: boolean
    onAddCodexAccountWithOAuth: () => Promise<boolean>
    onConnectCodexWithOAuth: () => Promise<boolean>
    onDisconnectCodex: () => Promise<boolean>
    onRemoveCodexAccount: (accountKey: string) => Promise<boolean>
    onRemoveApiKeyProvider: (providerId: ApiKeyProviderId) => Promise<boolean>
    onSaveApiKeyProvider: (input: SaveApiKeyProviderInput) => Promise<boolean>
    onSwitchCodexAccount: (accountId: string) => Promise<boolean>
    launchRequest: TideCodeSettingsLaunchRequest | null
    onLaunchRequestHandled: (request: TideCodeSettingsLaunchRequest) => void
    providersState: ProvidersState | null
  }
}

export function SettingsContent({
  activeItemId,
  appSettings,
  onBackToSettings,
  contextSettings,
  generalSettings,
  mcpSettings,
  skillsSettings,
  modelsSettings,
  providersSettings,
}: SettingsContentProps) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const surface = getRendererAppSettingsSurface()

  useLayoutEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = 0
    }
  }, [activeItemId])

  return (
    <div
      ref={scrollViewportRef}
      className="settings-scroll-viewport scroll-stable flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3 md:px-5 md:pb-0 md:pt-16"
    >
      <button
        type="button"
        onClick={onBackToSettings}
        className="mt-4 flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-sm font-medium text-foreground transition-colors duration-200 ease-out hover:bg-[var(--sidebar-hover-surface)] md:hidden"
      >
        <ArrowLeft size={18} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
        <span>Back to settings</span>
      </button>

      <div className="mt-5 flex w-full justify-center md:mt-0">
        <SettingsPanelSlot active={activeItemId === 'settings-item1'}>
          <MemoizedGeneralSettingsPanel {...generalSettings} />
        </SettingsPanelSlot>
        <SettingsPanelSlot active={activeItemId === 'settings-item2'}>
          <ProvidersSettingsPanel {...providersSettings} />
        </SettingsPanelSlot>
        <SettingsPanelSlot active={activeItemId === 'settings-item3'}>
          <ModelsSettingsPanel {...modelsSettings} />
        </SettingsPanelSlot>
        <SettingsPanelSlot active={activeItemId === 'settings-item4'}>
          <McpServersSettingsPanel {...mcpSettings} />
        </SettingsPanelSlot>
        <SettingsPanelSlot active={activeItemId === 'settings-item5'}>
          <SkillsSettingsPanel {...skillsSettings} />
        </SettingsPanelSlot>
        <SettingsPanelSlot active={activeItemId === 'settings-item6'}>
          <MemoizedTaskModelsSettingsPanel
            contextSettings={contextSettings}
            isLoading={generalSettings.isLoading}
            onUpdateSettings={generalSettings.onUpdateSettings}
            providersState={providersSettings.providersState}
            settings={appSettings}
          />
        </SettingsPanelSlot>
        <SettingsPanelSlot active={activeItemId === 'settings-item8'}>
          <RemoteSettingsPanel />
        </SettingsPanelSlot>
        {surface === 'desktop' ? (
          <SettingsPanelSlot active={activeItemId === 'settings-item7'}>
            <UpdatesSettingsPanel
              autoDownloadUpdates={appSettings.autoDownloadUpdates}
              checkForUpdatesOnLaunch={appSettings.checkForUpdatesOnLaunch}
              isLoading={generalSettings.isLoading}
              onUpdateSettings={generalSettings.onUpdateSettings}
            />
          </SettingsPanelSlot>
        ) : null}
      </div>
    </div>
  )
}
