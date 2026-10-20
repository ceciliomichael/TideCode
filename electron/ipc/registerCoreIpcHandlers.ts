import { BrowserWindow, dialog, ipcMain, shell, webContents, type OpenDialogOptions } from 'electron'
import type {
  ApiKeyProviderId,
  AppendConversationMessagesInput,
  AppSettings,
  AppSettingsSurface,
  ChatProviderId,
  CreateConversationFolderInput,
  CreateConversationInput,
  FolderMoveDirection,
  RenameConversationFolderInput,
  ReorderConversationFolderInput,
  ReplaceConversationMessagesInput,
  SaveApiKeyProviderInput,
  SaveCustomModelInput,
} from '../../src/types/chat'
import {
  cleanupUnreferencedStoredChatAttachments,
  cleanupDraftAgentContextDirectory,
  createStoredConversation,
  createStoredFolder,
  createStoredFolderFromPath,
  deleteStoredConversation,
  deleteStoredFolder,
  ensureDraftAgentContextDirectory,
  getStoredConversation,
  getStoredUserMessageCheckpointHistory,
  listStoredConversations,
  listStoredFolders,
  moveStoredFolder,
  renameStoredFolder,
  reorderStoredFolder,
  updateStoredConversationArchived,
  updateStoredConversationPinned,
  updateStoredConversationTitle,
} from '../history/store'
import { listCompactionMarkers } from '../chat/history/eventStore'
import { getDraftAgentContextPath } from '../history/paths'
import {
  cleanupChatAttachmentScope,
  cleanupDraftChatAttachments,
  listChatAttachments,
  readChatAttachmentImagePreview,
  readChatImageSource,
  storeChatAttachment,
  storeChatImageAttachment,
} from '../history/chatAttachments'
import { refreshProjectPathWatcher } from '../history/projectPathWatch'
import {
  createFolderPickerDirectory,
  deleteFolderPickerDirectory,
  getFolderPickerRoots,
  listFolderPickerDirectory,
  pasteFolderPickerClipboard,
  renameFolderPickerDirectory,
  writeFolderPickerClipboard,
} from '../folderPicker'
import { ensureRunServiceClient } from '../runService/ensureService'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import { isAppSettingsSurface } from '../../src/lib/appSettingsScopes'
import { applyTideCodeAppIcon } from '../window/branding'
import { browserFaviconCache } from '../browser/faviconCache'
import { applyWindowTheme } from '../window/theme'
import { createSkill, listAvailableSkills, loadSkill, updateSkill } from '../skills/service'
import type { BrowserDevToolsTargetInput } from '../../src/types/browser'
import { closeBrowserGuestDevTools, openBrowserGuestDevTools } from '../window/createApplicationWindow'
import { releaseBrowserProtocol } from '../browser/agentCdpSession'
import { registerBrowserPageActions } from '../browser/pageActions'
import {
  addCodexAccountWithOAuth,
  connectCodexWithOAuth,
  disconnectCodex,
  getProvidersState,
  removeApiKeyProvider,
  removeCodexAccount,
  saveApiKeyProvider,
  switchCodexAccount,
} from '../providers/service'
import {
  listCustomModels,
  listProviderModels,
  removeCustomModel,
  saveCustomModel,
} from '../models/service'

export function registerCoreIpcHandlers(
  getWindow: () => BrowserWindow | null,
onSettingsChanged?: (settings: AppSettings, input: Partial<AppSettings>, surface: AppSettingsSurface) => void | Promise<void>,
) {
  registerBrowserPageActions(getWindow)

  const resolveBrowserGuest = (senderId: number, webContentsId: number) => {
    if (!Number.isInteger(webContentsId) || webContentsId <= 0) {
      return null
    }

    const target = webContents.fromId(webContentsId)
    if (
      !target ||
      target.isDestroyed() ||
      target.getType() !== 'webview' ||
      target.hostWebContents?.id !== senderId
    ) {
      return null
    }

    return target
  }

  ipcMain.handle('browser:getFavicon', async (event, webContentsId: number) => {
    if (event.senderFrame !== event.sender.mainFrame || event.sender !== getWindow()?.webContents) {
      return null
    }
    const guest = resolveBrowserGuest(event.sender.id, webContentsId)
    if (!guest) {
      return null
    }
    return browserFaviconCache.get(guest)
  })

  ipcMain.handle('browser:openDevTools', async (event, input: BrowserDevToolsTargetInput) => {
    const activeWindow = getWindow()
    if (!activeWindow || event.sender !== activeWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
      return false
    }
    const target = resolveBrowserGuest(event.sender.id, input?.webContentsId)
    if (!target || activeWindow.isDestroyed()) {
      return false
    }
    releaseBrowserProtocol(target)
    await openBrowserGuestDevTools(target, activeWindow)
    return true
  })
  ipcMain.handle('browser:closeDevTools', async (event, input: BrowserDevToolsTargetInput) => {
    if (event.sender !== getWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) {
      return false
    }
    const target = resolveBrowserGuest(event.sender.id, input?.webContentsId)
    if (!target) {
      return false
    }
    closeBrowserGuestDevTools(target)
    return true
  })

  // Synchronous channel: lets the renderer read the draft path on first paint without an async round-trip
  ipcMain.on('history:getDraftAgentContextPathSync', (event) => {
    event.returnValue = getDraftAgentContextPath()
  })
  ipcMain.handle('history:ensureDraftAgentContext', async () => ensureDraftAgentContextDirectory())
  ipcMain.handle('history:cleanupDraftAgentContext', async () => {
    await Promise.all([
      cleanupDraftAgentContextDirectory(),
      cleanupDraftChatAttachments(),
    ])
  })
  ipcMain.handle('history:cleanupChatAttachmentScope', async (_event, scopeId: string) =>
    cleanupChatAttachmentScope(scopeId),
  )
  ipcMain.handle('history:cleanupUnreferencedChatAttachments', async (_event, conversationId: string, paths: string[]) =>
    cleanupUnreferencedStoredChatAttachments(conversationId, paths),
  )
  ipcMain.handle('history:storeChatAttachment', async (_event, input) => storeChatAttachment(input))
  ipcMain.handle('history:listChatAttachments', async (_event, conversationId: string) =>
    listChatAttachments(conversationId),
  )
  ipcMain.handle(
    'history:readChatAttachmentImagePreview',
    async (_event, conversationId: string, aliasPath: string) =>
      readChatAttachmentImagePreview(conversationId, aliasPath),
  )
  ipcMain.handle('history:readChatImageSource', async (_event, sourcePath: string) =>
    readChatImageSource(sourcePath),
  )
  ipcMain.handle('history:storeChatImageAttachment', async (_event, input) => storeChatImageAttachment(input))
  ipcMain.handle('history:pickAndStoreChatAttachmentFolder', async (_event, conversationId?: string | null) => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Attach folder',
    }
    const activeWindow = getWindow()
    const result = activeWindow
      ? await dialog.showOpenDialog(activeWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return storeChatAttachment({
      conversationId,
      sourcePath: result.filePaths[0],
    })
  })
  ipcMain.handle('history:list', async () => listStoredConversations())
  ipcMain.handle('history:listFolders', async () => listStoredFolders())
  ipcMain.handle('history:get', async (_event, conversationId: string) => getStoredConversation(conversationId))
  ipcMain.handle('history:listCompactionMarkers', async (_event, conversationId: string) =>
    listCompactionMarkers(conversationId),
  )
  ipcMain.handle('history:getUserMessageCheckpointHistory', async (_event, conversationId: string, messageId: string) =>
    getStoredUserMessageCheckpointHistory(conversationId, messageId),
  )
  ipcMain.handle('history:create', async (_event, input?: CreateConversationInput) => createStoredConversation(input))
  ipcMain.handle('history:createFolder', async (_event, input: CreateConversationFolderInput) => {
    const folder = await createStoredFolder(input)
    refreshProjectPathWatcher()
    return folder
  })
  ipcMain.handle('history:getFolderPickerRoots', async () => getFolderPickerRoots())
  ipcMain.handle('history:listFolderPickerDirectory', async (_event, folderPath: string) =>
    listFolderPickerDirectory(folderPath),
  )
  ipcMain.handle(
    'history:createFolderPickerDirectory',
    async (_event, parentPath: string, folderName: string) =>
      createFolderPickerDirectory(parentPath, folderName),
  )
  ipcMain.handle(
    'history:renameFolderPickerDirectory',
    async (_event, folderPath: string, folderName: string) =>
      renameFolderPickerDirectory(folderPath, folderName),
  )
  ipcMain.handle(
    'history:deleteFolderPickerDirectory',
    async (_event, folderPath: string) =>
      deleteFolderPickerDirectory(folderPath),
  )
  ipcMain.handle(
    'history:writeFolderPickerClipboard',
    async (_event, folderPath: string, mode: 'copy' | 'cut') =>
      writeFolderPickerClipboard(folderPath, mode),
  )
  ipcMain.handle(
    'history:pasteFolderPickerClipboard',
    async (_event, targetDirectoryPath: string) =>
      pasteFolderPickerClipboard(targetDirectoryPath),
  )
  ipcMain.handle('history:moveFolder', async (_event, folderId: string, direction: FolderMoveDirection) =>
    moveStoredFolder(folderId, direction),
  )
  ipcMain.handle('history:reorderFolder', async (_event, input: ReorderConversationFolderInput) =>
    reorderStoredFolder(input),
  )
  ipcMain.handle('history:renameFolder', async (_event, input: RenameConversationFolderInput) =>
    renameStoredFolder(input),
  )
  ipcMain.handle('history:deleteFolder', async (_event, folderId: string) => {
    const deletedConversationIds = await deleteStoredFolder(folderId)
    refreshProjectPathWatcher()
    return deletedConversationIds
  })
  ipcMain.handle('history:pickFolder', async () => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select folder',
    }
    const activeWindow = getWindow()
    const result = activeWindow
      ? await dialog.showOpenDialog(activeWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folder = await createStoredFolderFromPath(result.filePaths[0])
    refreshProjectPathWatcher()
    return folder
  })
  ipcMain.handle('history:createFolderFromPath', async (_event, folderPath: string) => {
    const folder = await createStoredFolderFromPath(folderPath)
    refreshProjectPathWatcher()
    return folder
  })
  ipcMain.handle('history:openFolderPath', async (_event, folderPath: string) => {
    await shell.openPath(folderPath)
  })
  ipcMain.handle('history:appendMessages', async (_event, input: AppendConversationMessagesInput) =>
    (await ensureRunServiceClient()).appendMessages(input),
  )
  ipcMain.handle('history:replaceMessages', async (_event, input: ReplaceConversationMessagesInput) =>
    (await ensureRunServiceClient()).replaceMessages(input),
  )
  ipcMain.handle('history:updateTitle', async (_event, conversationId: string, title: string) =>
    updateStoredConversationTitle(conversationId, title),
  )
  ipcMain.handle('history:updateArchived', async (_event, conversationId: string, isArchived: boolean) =>
    updateStoredConversationArchived(conversationId, isArchived),
  )
  ipcMain.handle('history:updatePinned', async (_event, conversationId: string, isPinned: boolean) =>
    updateStoredConversationPinned(conversationId, isPinned),
  )
  ipcMain.handle('history:delete', async (_event, conversationId: string) =>
    deleteStoredConversation(conversationId),
  )
  ipcMain.handle('settings:get', async (_event, requestedSurface?: AppSettingsSurface) => {
    const surface = isAppSettingsSurface(requestedSurface) ? requestedSurface : 'desktop'
    return getStoredSettings(surface)
  })
  ipcMain.handle('settings:update', async (_event, input: Partial<AppSettings>, requestedSurface?: AppSettingsSurface) => {
    const surface = isAppSettingsSurface(requestedSurface) ? requestedSurface : 'desktop'
    const nextSettings = await updateStoredSettings(input, surface)

    const activeWindow = getWindow()
    if (surface === 'desktop' && activeWindow) {
      applyWindowTheme(activeWindow, nextSettings.appearance)
      applyTideCodeAppIcon(activeWindow)
    }
    await onSettingsChanged?.(nextSettings, input, surface)

    return nextSettings
  })
  ipcMain.handle('skills:list', async (_event, workspacePath?: string | null) => listAvailableSkills(workspacePath))
  ipcMain.handle('skills:createSkill', async (_event, input: Parameters<typeof createSkill>[0], workspacePath?: string | null) =>
    createSkill(input, workspacePath),
  )
  ipcMain.handle('skills:loadSkill', async (_event, skillName: string, workspacePath?: string | null) =>
    loadSkill(skillName, workspacePath),
  )
  ipcMain.handle(
    'skills:updateSkill',
    async (
      _event,
      location: string,
      input: Parameters<typeof updateSkill>[1],
      workspacePath?: string | null,
    ) => updateSkill(location, input, workspacePath),
  )
  ipcMain.handle('providers:state', async (_event, hydrate?: boolean) => getProvidersState(hydrate === true))
  ipcMain.handle('providers:codex:addAccountOauth', async () => addCodexAccountWithOAuth((url) => shell.openExternal(url)))
  ipcMain.handle('providers:codex:connectOauth', async () => connectCodexWithOAuth((url) => shell.openExternal(url)))
  ipcMain.handle('providers:codex:disconnect', async () => disconnectCodex())
  ipcMain.handle('providers:codex:removeAccount', async (_event, accountKey: string) => removeCodexAccount(accountKey))
  ipcMain.handle('providers:codex:switchAccount', async (_event, accountKey: string) => switchCodexAccount(accountKey))
  ipcMain.handle('providers:apikey:save', async (_event, input: SaveApiKeyProviderInput) => saveApiKeyProvider(input))
  ipcMain.handle('providers:apikey:remove', async (_event, providerId: ApiKeyProviderId) =>
    removeApiKeyProvider(providerId),
  )
  ipcMain.handle('models:custom:list', async () => listCustomModels())
  ipcMain.handle('models:provider:list', async (_event, providerId: ChatProviderId) => listProviderModels(providerId))
  ipcMain.handle('models:custom:save', async (_event, input: SaveCustomModelInput) => saveCustomModel(input))
  ipcMain.handle('models:custom:remove', async (_event, modelId: string) => removeCustomModel(modelId))
}
