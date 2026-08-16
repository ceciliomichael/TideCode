import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { writeJsonFileAtomic } from '../../electron/settings/fileStore'
import { DEFAULT_APP_SETTINGS } from '../../src/lib/defaultAppSettings'

function buildFullStoredSettings() {
  return {
    ...DEFAULT_APP_SETTINGS,
    appearance: 'dark' as const,
    chatModelId: 'gpt-5.4',
    chatModelProviderId: 'codex' as const,
    chatModelLabel: 'gpt-5.4',
    chatReasoningEffort: 'high' as const,
    language: 'fil-PH' as const,
    sendMessageOnEnter: false,
    terminalExecutionMode: 'full' as const,
    conversationModelPreferences: {
      'thread-agent': {
        chatMode: 'agent' as const,
        label: 'Thread model',
        modelId: 'thread-model',
        providerId: 'codex' as const,
      },
    },
  }
}

test('writeJsonFileAtomic replaces an existing file without leaving a partial write behind', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-settings-atomic-'))
  const targetPath = path.join(tempRootPath, 'settings.json')
  const originalContent = JSON.stringify({ value: 'original' }, null, 2)
  const nextContent = JSON.stringify({ value: 'updated' }, null, 2)
  const originalRename = fs.rename.bind(fs)
  let shouldForceFallback = true

  try {
    await fs.writeFile(targetPath, originalContent, 'utf8')

    mock.method(fs, 'rename', async (source, destination) => {
      const normalizedDestination = String(destination)
      if (shouldForceFallback && normalizedDestination === targetPath) {
        shouldForceFallback = false
        const error = new Error('File exists') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      }

      return originalRename(source, destination)
    })

    await writeJsonFileAtomic(targetPath, nextContent)

    assert.equal(await fs.readFile(targetPath, 'utf8'), nextContent)
    await assert.rejects(fs.access(`${targetPath}.bak`), { code: 'ENOENT' })
  } finally {
    mock.restoreAll()
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('updateStoredSettings preserves saved preferences when the cache is available', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-settings-cache-'))
  const configDirectoryPath = path.join(tempHomePath, '.tidecode', 'config')
  const settingsFilePath = path.join(configDirectoryPath, 'settings.json')
  const workspaceUiStateFilePath = path.join(configDirectoryPath, 'workspace-ui-state.json')
  const initialSettings = buildFullStoredSettings()
  const originalReadFile = fs.readFile.bind(fs)
  const previousSettingsHome = process.env.TIDECODE_SETTINGS_HOME
  const initialWorkspaceUiState = {
    conversationModelPreferences: initialSettings.conversationModelPreferences,
    diffPanelWidth: initialSettings.diffPanelWidth,
    editSessionsByConversation: initialSettings.editSessionsByConversation,
    lastActiveConversationId: initialSettings.lastActiveConversationId,
    lastActiveDraftFolderId: initialSettings.lastActiveDraftFolderId,
    openEmptyConversationOnLaunch: initialSettings.openEmptyConversationOnLaunch,
    revertEditSessionsByConversation: initialSettings.revertEditSessionsByConversation,
    sidebarWidth: initialSettings.sidebarWidth,
    sourceControlSectionOrder: initialSettings.sourceControlSectionOrder,
    sourceControlSectionOpen: initialSettings.sourceControlSectionOpen,
    sourceControlSectionSizes: initialSettings.sourceControlSectionSizes,
    terminalOpenByWorkspace: initialSettings.terminalOpenByWorkspace,
    terminalPanelHeightsByWorkspace: initialSettings.terminalPanelHeightsByWorkspace,
    workspaceEditorWidth: initialSettings.workspaceEditorWidth,
    workspaceExplorerWidth: initialSettings.workspaceExplorerWidth,
  }

  try {
    process.env.TIDECODE_SETTINGS_HOME = tempHomePath

    await fs.mkdir(configDirectoryPath, { recursive: true })
    await fs.writeFile(settingsFilePath, JSON.stringify(initialSettings, null, 2), 'utf8')
    await fs.writeFile(workspaceUiStateFilePath, JSON.stringify(initialWorkspaceUiState, null, 2), 'utf8')

    const { getStoredSettings, updateStoredSettings } = await import('../../electron/settings/store')
    const loadedSettings = await getStoredSettings()

    assert.equal(loadedSettings.appearance, 'dark')
    assert.equal(loadedSettings.chatModelId, 'gpt-5.4')
    assert.equal(loadedSettings.conversationModelPreferences['thread-agent']?.chatMode, 'agent')

    mock.method(fs, 'readFile', async () => {
      throw new Error('settings read should not be needed after the cache is populated')
    })

    const updatedSettings = await updateStoredSettings({ appearance: 'light' })

    assert.equal(updatedSettings.appearance, 'light')
    assert.equal(updatedSettings.chatModelId, 'gpt-5.4')
    assert.equal(updatedSettings.chatModelProviderId, 'codex')
    assert.equal(updatedSettings.language, 'fil-PH')
    assert.equal(updatedSettings.terminalExecutionMode, 'full')

    const persistedSettings = JSON.parse(await originalReadFile(settingsFilePath, 'utf8')) as typeof initialSettings
    assert.equal(persistedSettings.appearance, 'light')
    assert.equal(persistedSettings.chatModelId, 'gpt-5.4')
    assert.equal(persistedSettings.chatModelProviderId, 'codex')
  } finally {
    mock.restoreAll()
    if (previousSettingsHome === undefined) {
      delete process.env.TIDECODE_SETTINGS_HOME
    } else {
      process.env.TIDECODE_SETTINGS_HOME = previousSettingsHome
    }
    await fs.rm(tempHomePath, { force: true, recursive: true })
  }
})
