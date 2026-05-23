import { MemoizedGeneralSettingsPanel } from './general/GeneralSettingsPanel'
import { McpServersSettingsPanel } from './mcp/McpServersSettingsPanel'
import { ModelsSettingsPanel } from './models/ModelsSettingsPanel'
import { ProvidersSettingsPanel } from './providers/ProvidersSettingsPanel'
import { SkillsSettingsPanel } from './skills/SkillsSettingsPanel'
import { MemoizedTaskModelsSettingsPanel } from './taskModels/TaskModelsSettingsPanel'
import { SettingsPlaceholderPanel } from './SettingsPlaceholderPanel'
import { getSettingsItem, type SettingsItemId } from './settingsItems'
import type { AppAppearance, AppLanguage, FollowUpBehavior } from '../../lib/appSettings'
import type { ApiKeyProviderId, AppSettings, ProvidersState, SaveApiKeyProviderInput } from '../../types/chat'
import type { McpAddServerInput, McpState } from '../../types/mcp'
import type { SkillsState } from '../../types/skills'

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
    onUpdateSettings: (input: Partial<AppSettings>) => void
    settings: Pick<AppSettings, 'disabledSkillsByPath'>
    state: SkillsState | null
  }
  modelsSettings: {
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
    onRefreshProvidersState: () => Promise<void>
    onSaveApiKeyProvider: (input: SaveApiKeyProviderInput) => Promise<boolean>
    onSwitchCodexAccount: (accountId: string) => Promise<boolean>
    providersState: ProvidersState | null
  }
}

export function SettingsContent({
  activeItemId,
  appSettings,
  generalSettings,
  mcpSettings,
  skillsSettings,
  modelsSettings,
  providersSettings,
}: SettingsContentProps) {
  const activeItem = getSettingsItem(activeItemId)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-12 md:px-5 md:pt-16">
      <div className="flex w-full justify-center">
        {activeItemId === 'settings-item1' ? (
          <MemoizedGeneralSettingsPanel {...generalSettings} />
        ) : activeItemId === 'settings-item2' ? (
          <ProvidersSettingsPanel {...providersSettings} />
        ) : activeItemId === 'settings-item3' ? (
          <ModelsSettingsPanel {...modelsSettings} />
        ) : activeItemId === 'settings-item4' ? (
          <McpServersSettingsPanel {...mcpSettings} />
        ) : activeItemId === 'settings-item5' ? (
          <SkillsSettingsPanel {...skillsSettings} />
        ) : activeItemId === 'settings-item6' ? (
          <MemoizedTaskModelsSettingsPanel
            isLoading={generalSettings.isLoading}
            onUpdateSettings={generalSettings.onUpdateSettings}
            providersState={providersSettings.providersState}
            settings={{
              agentModelId: appSettings.agentModelId,
              agentModelLabel: appSettings.agentModelLabel,
              agentModelProviderId: appSettings.agentModelProviderId,
              gitCommitModelId: appSettings.gitCommitModelId,
              gitCommitModelLabel: appSettings.gitCommitModelLabel,
              gitCommitModelProviderId: appSettings.gitCommitModelProviderId,
              planModelId: appSettings.planModelId,
              planModelLabel: appSettings.planModelLabel,
              planModelProviderId: appSettings.planModelProviderId,
              summarizationModelId: appSettings.summarizationModelId,
              summarizationModelLabel: appSettings.summarizationModelLabel,
              summarizationModelProviderId: appSettings.summarizationModelProviderId,
            }}
          />
        ) : (
          <SettingsPlaceholderPanel item={activeItem} />
        )}
      </div>
      <div className="h-12 shrink-0 md:h-16" aria-hidden="true" />
    </div>
  )
}
