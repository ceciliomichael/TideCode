import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppWorkspaceShell } from '../components/layout/AppWorkspaceShell'
import { WorkspaceFloatingControls } from '../components/layout/WorkspaceFloatingControls'
import { WorkspacePanel } from '../components/layout/WorkspacePanel'
import { SettingsContent } from '../components/settings/SettingsContent'
import { SettingsSidebarPanel } from '../components/settings/SettingsSidebarPanel'
import {
  DEFAULT_SETTINGS_ITEM_ID,
  type SettingsItemId,
} from '../components/settings/settingsItems'
import type { UseMcpServersStateResult } from '../hooks/useMcpServersState'
import type { UseSkillsStateResult } from '../hooks/useSkillsState'
import { useWorkspaceKeyboardShortcuts } from '../hooks/useWorkspaceKeyboardShortcuts'
import { useIsMobileViewport } from '../hooks/useIsMobileViewport'
import type { AppSettings, ApiKeyProviderId, ProvidersState, SaveApiKeyProviderInput } from '../types/chat'
import type { TideCodeLaunchRequest, TideCodeSettingsLaunchRequest } from '../lib/appLaunchRequest'

interface SettingsInterfaceProps {
  initialItemId: SettingsItemId | null
  isActiveScreen: boolean
  isSettingsLoading: boolean
  mcpSettings: UseMcpServersStateResult
  onLaunchRequestConsumed: () => void
  onBackToApp: () => void
  onSidebarWidthChange: (sidebarWidth: number) => void
  onUpdateSettings: (input: Partial<AppSettings>) => Promise<AppSettings | null>
  sidebarWidth: number
  settings: AppSettings
  pendingLaunchRequest: TideCodeLaunchRequest | null
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
  skillsState: UseSkillsStateResult
}

export function SettingsInterface({
  initialItemId,
  isActiveScreen,
  isSettingsLoading,
  mcpSettings,
  onLaunchRequestConsumed,
  onBackToApp,
  onSidebarWidthChange,
  onUpdateSettings,
  providersState,
  skillsState,
  sidebarWidth,
  settings,
  pendingLaunchRequest,
}: SettingsInterfaceProps) {
  const isMobileViewport = useIsMobileViewport()
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => !isMobileViewport || initialItemId === null)
  const [activeItemId, setActiveItemId] = useState<SettingsItemId>(initialItemId ?? DEFAULT_SETTINGS_ITEM_ID)
  const [panelLaunchRequest, setPanelLaunchRequest] = useState<TideCodeSettingsLaunchRequest | null>(null)
  const wasActiveScreenRef = useRef(false)
  const handleUpdateSettings = useCallback((input: Partial<AppSettings>) => {
    void onUpdateSettings(input)
  }, [onUpdateSettings])
  const handleLaunchRequestHandled = useCallback((request: TideCodeSettingsLaunchRequest) => {
    setPanelLaunchRequest((currentRequest) => currentRequest === request ? null : currentRequest)
  }, [])
  useLayoutEffect(() => {
    const becameActive = isActiveScreen && !wasActiveScreenRef.current
    wasActiveScreenRef.current = isActiveScreen
    if (!becameActive) return

    setActiveItemId(initialItemId ?? DEFAULT_SETTINGS_ITEM_ID)
    setIsSidebarOpen(!isMobileViewport || initialItemId === null)
  }, [initialItemId, isActiveScreen, isMobileViewport])

  useLayoutEffect(() => {
    if (!pendingLaunchRequest) return

    setActiveItemId(pendingLaunchRequest.section === 'providers' ? 'settings-item2' : 'settings-item3')
    if (isMobileViewport) setIsSidebarOpen(false)
    setPanelLaunchRequest(pendingLaunchRequest.action ? pendingLaunchRequest : null)
    onLaunchRequestConsumed()
  }, [isMobileViewport, onLaunchRequestConsumed, pendingLaunchRequest])
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

  const handleSelectSettingsItem = useCallback((itemId: SettingsItemId) => {
    setActiveItemId(itemId)
    if (isMobileViewport) setIsSidebarOpen(false)
  }, [isMobileViewport])

  useWorkspaceKeyboardShortcuts({
    enabled: isActiveScreen,
    onToggleSidebar: () => setIsSidebarOpen((currentValue) => !currentValue),
  })

  return (
    <AppWorkspaceShell
      isSidebarOpen={isSidebarOpen}
      onSidebarWidthChange={onSidebarWidthChange}
      floatingControls={
        isMobileViewport ? null : (
          <WorkspaceFloatingControls
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((currentValue) => !currentValue)}
          />
        )
      }
      sidebar={
        <SettingsSidebarPanel
          activeItemId={activeItemId}
          onBackToApp={onBackToApp}
          onSelectItem={handleSelectSettingsItem}
        />
      }
      sidebarWidth={sidebarWidth}
    >
      <WorkspacePanel isSidebarOpen={isSidebarOpen} showRightBorder={false}>
        <SettingsContent
          activeItemId={activeItemId}
          appSettings={settings}
          onBackToSettings={() => setIsSidebarOpen(true)}
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
            launchRequest: panelLaunchRequest,
            onLaunchRequestHandled: handleLaunchRequestHandled,
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
            launchRequest: panelLaunchRequest,
            onLaunchRequestHandled: handleLaunchRequestHandled,
            providersState: providersState.providersState,
          }}
        />
      </WorkspacePanel>
    </AppWorkspaceShell>
  )
}
