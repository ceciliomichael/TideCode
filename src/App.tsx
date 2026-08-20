import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { DiffPanelScope } from './components/chat/ConversationDiffPanel'
import { ChatInterface, type RightPanelTab } from './pages/ChatInterface'
import { SettingsInterface } from './pages/SettingsInterface'
import { useAppSettings } from './hooks/useAppSettings'
import { useChatMessages } from './hooks/useChatMessages'
import { useDocumentTheme } from './hooks/useDocumentTheme'
import { useMcpServersState } from './hooks/useMcpServersState'
import { useProvidersState } from './hooks/useProvidersState'
import { useSkillsState } from './hooks/useSkillsState'
import type { TideCodeLaunchRequest } from './lib/appLaunchRequest'
import { resolveBootConversationLaunchState } from './pages/chatInterface/chatLaunchState'
import { hydrateCachedUpdate, requestAutomaticUpdateCheck } from './components/settings/updates/updatesSessionStore'
import type { SettingsItemId } from './components/settings/settingsItems'

type AppScreen = 'chat' | 'settings'

export default function App() {
  const [initialLaunchRequest] = useState<TideCodeLaunchRequest | null>(() => window.tidecodeApp.getInitialLaunchRequest())
  const [activeScreen, setActiveScreen] = useState<AppScreen>(initialLaunchRequest ? 'settings' : 'chat')
  const [settingsInitialItemId, setSettingsInitialItemId] = useState<SettingsItemId | null>(null)
  const [pendingLaunchRequest, setPendingLaunchRequest] = useState<TideCodeLaunchRequest | null>(initialLaunchRequest)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('diff')
  const [diffPanelSelectedScope, setDiffPanelSelectedScope] = useState<DiffPanelScope>('unstaged')
  const [diffPanelExpandedFilePaths, setDiffPanelExpandedFilePaths] = useState<string[]>([])
  const { isLoading, settings, updateSettings } = useAppSettings()
  const providersState = useProvidersState()
  const { refreshInBackground } = providersState
  const [diffPanelWidth, setDiffPanelWidth] = useState(settings.diffPanelWidth)
  const [checkForUpdatesOnLaunchAtBoot] = useState(() => settings.checkForUpdatesOnLaunch)
  const [bootConversationLaunchState] = useState(() => resolveBootConversationLaunchState(settings))
  const persistConversationLaunchPreference = useCallback(
    (input: {
      conversationId: string | null
      draftFolderId: string | null
      openEmptyConversationOnLaunch: boolean
    }) => {
      void updateSettings({
        lastActiveConversationId: input.conversationId,
        lastActiveDraftFolderId: input.draftFolderId,
        openEmptyConversationOnLaunch: input.openEmptyConversationOnLaunch,
      })
    },
    [updateSettings],
  )
  const chatMessages = useChatMessages({
    conversationModelPreferences: settings.conversationModelPreferences,
    editSessionsByConversation: settings.editSessionsByConversation,
    language: settings.language,
    onPersistConversationModelPreferences: (nextValue) => {
      void updateSettings({ conversationModelPreferences: nextValue })
    },
    openEmptyConversationOnLaunch: bootConversationLaunchState.openEmptyConversationOnLaunch,
    persistConversationLaunchPreference,
    persistEditSessionsByConversation: (nextValue) => {
      void updateSettings({ editSessionsByConversation: nextValue })
    },
    persistRevertEditSessionsByConversation: (nextValue) => {
      void updateSettings({ revertEditSessionsByConversation: nextValue })
    },
    preferredDraftFolderId: bootConversationLaunchState.preferredDraftFolderId,
    preferredDraftFolderName: bootConversationLaunchState.preferredDraftFolderName,
    preferredConversationId: bootConversationLaunchState.preferredConversationId,
    revertEditSessionsByConversation: settings.revertEditSessionsByConversation,
    shouldInitializeHistory: true,
  })
  const activeWorkspacePath = chatMessages.activeConversationRootPath ?? chatMessages.selectedFolderPath
  const skillsState = useSkillsState(activeWorkspacePath)
  const mcpSettings = useMcpServersState(null)
  const handleSidebarWidthChange = useCallback((sidebarWidth: number) => {
    void updateSettings({ sidebarWidth })
  }, [updateSettings])
  const handleDiffPanelWidthChange = useCallback((nextWidth: number) => {
    setDiffPanelWidth(nextWidth)
  }, [])
  const handleDiffPanelWidthCommit = useCallback(
    (nextWidth: number) => {
      if (nextWidth === settings.diffPanelWidth) {
        return
      }

      void updateSettings({ diffPanelWidth: nextWidth })
    },
    [settings.diffPanelWidth, updateSettings],
  )

  const resolvedTheme = useDocumentTheme(settings.appearance)

  useEffect(() => {
    void hydrateCachedUpdate()
    if (checkForUpdatesOnLaunchAtBoot) {
      requestAutomaticUpdateCheck()
    }
  }, [checkForUpdatesOnLaunchAtBoot])

  useEffect(() => {
    return window.tidecodeApp.onLaunchRequest((request) => {
      setSettingsInitialItemId(null)
      setActiveScreen('settings')
      setPendingLaunchRequest(request)
    })
  }, [])

  const consumeLaunchRequest = useCallback(() => {
    setPendingLaunchRequest(null)
  }, [])
  const handleOpenSettings = useCallback((itemId?: SettingsItemId) => {
    setSettingsInitialItemId(itemId ?? null)
    setActiveScreen('settings')
  }, [])

  useLayoutEffect(() => {
    setDiffPanelWidth(settings.diffPanelWidth)
  }, [settings.diffPanelWidth])

  useEffect(() => {
    if (activeScreen !== 'settings') {
      return
    }

    void refreshInBackground()
  }, [activeScreen, refreshInBackground])

  useEffect(() => {
    if (isLoading || chatMessages.isLoading) {
      return
    }

    const activeConversationId = chatMessages.activeConversationId
    const activeFolderId = chatMessages.selectedFolderId ?? null

    if (!activeConversationId) {
      if (
        settings.lastActiveConversationId === null &&
        settings.lastActiveDraftFolderId === activeFolderId &&
        settings.openEmptyConversationOnLaunch
      ) {
        return
      }

      void updateSettings({
        lastActiveConversationId: null,
        lastActiveDraftFolderId: activeFolderId,
        openEmptyConversationOnLaunch: true,
      })
      return
    }

    if (
      activeConversationId === settings.lastActiveConversationId &&
      activeFolderId === settings.lastActiveDraftFolderId &&
      !settings.openEmptyConversationOnLaunch
    ) {
      return
    }

    void updateSettings({
      lastActiveConversationId: activeConversationId,
      lastActiveDraftFolderId: activeFolderId,
      openEmptyConversationOnLaunch: false,
    })
  }, [
    chatMessages.activeConversationId,
    chatMessages.isLoading,
    chatMessages.selectedFolderId,
    isLoading,
    settings.lastActiveConversationId,
    settings.lastActiveDraftFolderId,
    settings.openEmptyConversationOnLaunch,
    updateSettings,
  ])

  return (
    <div className="relative h-screen w-screen">
      <div
        className={[
          'absolute inset-0',
          activeScreen === 'chat' ? 'visible' : 'invisible',
        ].join(' ')}
        aria-hidden={activeScreen !== 'chat'}
      >
        <ChatInterface
          chatMessages={chatMessages}
        diffPanelWidth={diffPanelWidth}
        diffPanelExpandedFilePaths={diffPanelExpandedFilePaths}
        diffPanelSelectedScope={diffPanelSelectedScope}
        isActiveScreen={activeScreen === 'chat'}
        isRightPanelOpen={isRightPanelOpen}
        rightPanelTab={rightPanelTab}
        onDiffPanelExpandedFilePathsChange={setDiffPanelExpandedFilePaths}
        onRightPanelOpenChange={setIsRightPanelOpen}
        onRightPanelTabChange={setRightPanelTab}
        onDiffPanelSelectedScopeChange={setDiffPanelSelectedScope}
        onDiffPanelWidthChange={handleDiffPanelWidthChange}
        onDiffPanelWidthCommit={handleDiffPanelWidthCommit}
        resolvedTheme={resolvedTheme}
        settings={settings}
        onUpdateSettings={updateSettings}
        onSidebarWidthChange={handleSidebarWidthChange}
        sendMessageOnEnter={settings.sendMessageOnEnter}
        sidebarWidth={settings.sidebarWidth}
        onOpenSettings={handleOpenSettings}
          providersState={{
            isLoading: providersState.isLoading,
            providersState: providersState.providersState,
          }}
        />
      </div>

      <div
        className={[
          'absolute inset-0 z-50',
          activeScreen === 'settings' ? 'visible' : 'invisible pointer-events-none',
        ].join(' ')}
        aria-hidden={activeScreen !== 'settings'}
      >
        <SettingsInterface
          isActiveScreen={activeScreen === 'settings'}
          initialItemId={settingsInitialItemId}
          onLaunchRequestConsumed={consumeLaunchRequest}
          settings={settings}
          isSettingsLoading={isLoading}
          onBackToApp={() => setActiveScreen('chat')}
          onSidebarWidthChange={handleSidebarWidthChange}
          onUpdateSettings={updateSettings}
          mcpSettings={mcpSettings}
          providersState={{
            activeOperation: providersState.activeOperation,
            addCodexAccountWithOAuth: providersState.addCodexAccountWithOAuth,
            connectCodexWithOAuth: providersState.connectCodexWithOAuth,
            disconnectCodex: providersState.disconnectCodex,
            removeCodexAccount: providersState.removeCodexAccount,
            errorMessage: providersState.errorMessage,
            isLoading: providersState.isLoading,
            onRemoveApiKeyProvider: providersState.removeApiKeyProvider,
            onSaveApiKeyProvider: providersState.saveApiKeyProvider,
            onSwitchCodexAccount: providersState.switchCodexAccount,
            providersState: providersState.providersState,
          }}
          skillsState={skillsState}
          sidebarWidth={settings.sidebarWidth}
          pendingLaunchRequest={pendingLaunchRequest}
        />
      </div>
    </div>
  )
}
