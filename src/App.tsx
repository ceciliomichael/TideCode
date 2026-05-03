import { useCallback, useEffect, useState } from 'react'
import type { DiffPanelScope } from './components/chat/ConversationDiffPanel'
import { ChatInterface, type RightPanelTab } from './pages/ChatInterface'
import { SettingsInterface } from './pages/SettingsInterface'
import { useAppSettings } from './hooks/useAppSettings'
import { useChatMessages } from './hooks/useChatMessages'
import { useDocumentTheme } from './hooks/useDocumentTheme'
import { useProvidersState } from './hooks/useProvidersState'

type AppScreen = 'chat' | 'settings'

interface BootConversationLaunchState {
  preferredDraftFolderId: string | null
  preferredConversationId: string | null
  openEmptyConversationOnLaunch: boolean
}

export default function App() {
  const [activeScreen, setActiveScreen] = useState<AppScreen>('chat')
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('diff')
  const [diffPanelSelectedScope, setDiffPanelSelectedScope] = useState<DiffPanelScope>('unstaged')
  const [diffPanelExpandedFilePaths, setDiffPanelExpandedFilePaths] = useState<string[]>([])
  const { isLoading, settings, updateSettings } = useAppSettings()
  const providersState = useProvidersState()
  const [diffPanelWidth, setDiffPanelWidth] = useState(settings.diffPanelWidth)
  const [bootConversationLaunchState, setBootConversationLaunchState] = useState<BootConversationLaunchState | undefined>(
    undefined,
  )
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
    editSessionsByConversation: settings.editSessionsByConversation,
    language: settings.language,
    openEmptyConversationOnLaunch: bootConversationLaunchState?.openEmptyConversationOnLaunch ?? false,
    persistConversationLaunchPreference,
    persistEditSessionsByConversation: (nextValue) => {
      void updateSettings({ editSessionsByConversation: nextValue })
    },
    persistRevertEditSessionsByConversation: (nextValue) => {
      void updateSettings({ revertEditSessionsByConversation: nextValue })
    },
    preferredDraftFolderId: bootConversationLaunchState?.preferredDraftFolderId ?? null,
    preferredConversationId: bootConversationLaunchState?.preferredConversationId ?? null,
    revertEditSessionsByConversation: settings.revertEditSessionsByConversation,
    shouldInitializeHistory: bootConversationLaunchState !== undefined,
  })
  const activeWorkspacePath = chatMessages.activeConversationRootPath ?? chatMessages.selectedFolderPath
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
    setDiffPanelWidth(settings.diffPanelWidth)
  }, [settings.diffPanelWidth])

  useEffect(() => {
    if (activeScreen !== 'settings') {
      return
    }

    void providersState.refreshInBackground()
  }, [activeScreen, providersState.refreshInBackground])

  useEffect(() => {
    if (isLoading || bootConversationLaunchState !== undefined) {
      return
    }

    setBootConversationLaunchState({
      preferredDraftFolderId: settings.lastActiveDraftFolderId,
      openEmptyConversationOnLaunch: settings.openEmptyConversationOnLaunch,
      preferredConversationId: settings.lastActiveConversationId,
    })
  }, [
    bootConversationLaunchState,
    isLoading,
    settings.lastActiveConversationId,
    settings.lastActiveDraftFolderId,
    settings.openEmptyConversationOnLaunch,
  ])

  useEffect(() => {
    if (isLoading || chatMessages.isLoading) {
      return
    }

    const activeConversationId = chatMessages.activeConversationId
    if (!activeConversationId) {
      return
    }

    if (
      activeConversationId === settings.lastActiveConversationId &&
      settings.lastActiveDraftFolderId === null &&
      !settings.openEmptyConversationOnLaunch
    ) {
      return
    }

    void updateSettings({
      lastActiveConversationId: activeConversationId,
      lastActiveDraftFolderId: null,
      openEmptyConversationOnLaunch: false,
    })
  }, [
    chatMessages.activeConversationId,
    chatMessages.isLoading,
    isLoading,
    settings.lastActiveConversationId,
    settings.lastActiveDraftFolderId,
    settings.openEmptyConversationOnLaunch,
    updateSettings,
  ])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--workspace-shell-surface)] px-4 text-sm text-subtle-foreground">
        Loading workspace...
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen">
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
        onOpenSettings={() => setActiveScreen('settings')}
        providersState={{
          isLoading: providersState.isLoading,
          providersState: providersState.providersState,
        }}
      />

      {activeScreen === 'settings' ? (
        <div className="absolute inset-0 z-50">
          <SettingsInterface
            activeWorkspacePath={activeWorkspacePath}
            settings={settings}
            isSettingsLoading={isLoading}
            onBackToApp={() => setActiveScreen('chat')}
            onSidebarWidthChange={handleSidebarWidthChange}
            onUpdateSettings={updateSettings}
            providersState={{
              activeOperation: providersState.activeOperation,
              addCodexAccountWithOAuth: providersState.addCodexAccountWithOAuth,
              connectCodexWithOAuth: providersState.connectCodexWithOAuth,
              disconnectCodex: providersState.disconnectCodex,
              errorMessage: providersState.errorMessage,
              isLoading: providersState.isLoading,
              onRemoveApiKeyProvider: providersState.removeApiKeyProvider,
              onRefreshProvidersState: providersState.refreshInBackground,
              onSaveApiKeyProvider: providersState.saveApiKeyProvider,
              onSwitchCodexAccount: providersState.switchCodexAccount,
              providersState: providersState.providersState,
            }}
            sidebarWidth={settings.sidebarWidth}
          />
        </div>
      ) : null}
    </div>
  )
}
