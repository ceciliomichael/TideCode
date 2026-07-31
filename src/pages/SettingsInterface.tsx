import { useCallback, useMemo, useState } from 'react'
import { AppWorkspaceShell } from '../components/layout/AppWorkspaceShell'
import { WorkspaceFloatingControls } from '../components/layout/WorkspaceFloatingControls'
import { WorkspacePanel } from '../components/layout/WorkspacePanel'
import { SettingsContent } from '../components/settings/SettingsContent'
import { SettingsSidebarPanel } from '../components/settings/SettingsSidebarPanel'
import {
  DEFAULT_SETTINGS_ITEM_ID,
  type SettingsItemId,
} from '../components/settings/settingsItems'
import { useMcpServersState } from '../hooks/useMcpServersState'
import { useSkillsState } from '../hooks/useSkillsState'
import { useWorkspaceKeyboardShortcuts } from '../hooks/useWorkspaceKeyboardShortcuts'
import type { AppSettings, ApiKeyProviderId, ProvidersState, SaveApiKeyProviderInput } from '../types/chat'

interface SettingsInterfaceProps {
  activeWorkspacePath: string | null
  isSettingsLoading: boolean
  onBackToApp: () => void
  onSidebarWidthChange: (sidebarWidth: number) => void
  onUpdateSettings: (input: Partial<AppSettings>) => Promise<AppSettings | null>
  sidebarWidth: number
  settings: AppSettings
  providersState: {
    activeOperation: string | null
    addCodexAccountWithOAuth: () => Promise<boolean>
    connectCodexWithOAuth: () => Promise<boolean>
    disconnectCodex: () => Promise<boolean>
    removeCodexAccount: (accountKey: string) => Promise<boolean>
    errorMessage: string | null
    isLoading: boolean
    onRemoveApiKeyProvider: (providerId: ApiKeyProviderId) => Promise<boolean>
    onSaveApiKeyProvider: (input: SaveApiKeyProviderInput) => Promise<boolean>
    onSwitchCodexAccount: (accountId: string) => Promise<boolean>
    providersState: ProvidersState | null
  }
}

export function SettingsInterface({
  activeWorkspacePath,
  isSettingsLoading,
  onBackToApp,
  onSidebarWidthChange,
  onUpdateSettings,
  providersState,
  sidebarWidth,
  settings,
}: SettingsInterfaceProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [activeItemId, setActiveItemId] = useState<SettingsItemId>(DEFAULT_SETTINGS_ITEM_ID)
  const mcpSettings = useMcpServersState(activeWorkspacePath)
  const skillsState = useSkillsState(activeWorkspacePath)
  const handleUpdateSettings = useCallback((input: Partial<AppSettings>) => {
    void onUpdateSettings(input)
  }, [onUpdateSettings])
  const generalSettings = useMemo(
    () => ({
      isLoading: isSettingsLoading,
      onUpdateSettings: handleUpdateSettings,
      settings: {
        appearance: settings.appearance,
        followUpBehavior: settings.followUpBehavior,
        language: settings.language,
        sendMessageOnEnter: settings.sendMessageOnEnter,
        workspaceFileEditorWordWrap: settings.workspaceFileEditorWordWrap,
      },
    }),
    [
      handleUpdateSettings,
      isSettingsLoading,
      settings.appearance,
      settings.followUpBehavior,
      settings.language,
      settings.sendMessageOnEnter,
      settings.workspaceFileEditorWordWrap,
    ],
  )

  useWorkspaceKeyboardShortcuts({
    onToggleSidebar: () => setIsSidebarOpen((currentValue) => !currentValue),
  })

  return (
    <AppWorkspaceShell
      isSidebarOpen={isSidebarOpen}
      onSidebarWidthChange={onSidebarWidthChange}
      floatingControls={
        <WorkspaceFloatingControls
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((currentValue) => !currentValue)}
        />
      }
      sidebar={
        <SettingsSidebarPanel
          activeItemId={activeItemId}
          onBackToApp={onBackToApp}
          onSelectItem={setActiveItemId}
        />
      }
      sidebarWidth={sidebarWidth}
    >
      <WorkspacePanel isSidebarOpen={isSidebarOpen} showRightBorder={false}>
        <SettingsContent
          activeItemId={activeItemId}
          appSettings={settings}
          contextSettings={{
            isLoading: isSettingsLoading,
            onUpdateSettings: handleUpdateSettings,
            settings: settings.contextCompaction,
          }}
          generalSettings={generalSettings}
          mcpSettings={{
            activeOperation: mcpSettings.activeOperation,
            onAddServer: mcpSettings.addServer,
            errorMessage: mcpSettings.errorMessage,
            isLoading: mcpSettings.isLoading,
            onConnectServer: mcpSettings.connectServer,
            onDisconnectServer: mcpSettings.disconnectServer,
            onRemoveServer: mcpSettings.removeServer,
            onToggleTool: mcpSettings.toggleTool,
            onUpdateServer: mcpSettings.updateServer,
            state: mcpSettings.state,
          }}
          skillsSettings={{
            errorMessage: skillsState.errorMessage,
            isLoading: skillsState.isLoading,
            onCreateSkill: skillsState.createSkill,
            onUpdateSettings: handleUpdateSettings,
            settings: {
              disabledSkillsByPath: settings.disabledSkillsByPath,
            },
            state: skillsState.state,
          }}
          modelsSettings={{
            providersState: providersState.providersState,
          }}
          providersSettings={{
            activeOperation: providersState.activeOperation,
            errorMessage: providersState.errorMessage,
            isLoading: providersState.isLoading,
            onAddCodexAccountWithOAuth: providersState.addCodexAccountWithOAuth,
            onConnectCodexWithOAuth: providersState.connectCodexWithOAuth,
            onDisconnectCodex: providersState.disconnectCodex,
            onRemoveCodexAccount: providersState.removeCodexAccount,
            onRemoveApiKeyProvider: providersState.onRemoveApiKeyProvider,
            onSaveApiKeyProvider: providersState.onSaveApiKeyProvider,
            onSwitchCodexAccount: providersState.onSwitchCodexAccount,
            providersState: providersState.providersState,
          }}
        />
      </WorkspacePanel>
    </AppWorkspaceShell>
  )
}
