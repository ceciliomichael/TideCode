import { BrowserWindow, dialog, ipcMain, shell, webContents, WebContentsView, type OpenDialogOptions } from 'electron'
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
import type {
  KanbanBoardData,
  KanbanCreateCardRequest,
  KanbanCreateTaskRequest,
  KanbanDeleteCardRequest,
  KanbanMoveCardRequest,
  KanbanReadBoardRequest,
  KanbanReadCardRequest,
  KanbanReorderCardRequest,
  KanbanTaskPlanInput,
  KanbanUpdateCardInput,
  KanbanUpdateCardRequest,
  KanbanWorkspaceInput,
} from '../../src/lib/kanban'
import {
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
import {
  type BrowserDevToolsDockMode,
  type BrowserDevToolsMenuInput,
  isBrowserDevToolsDockMode,
  type BrowserDevToolsTargetInput,
  type OpenBrowserDevToolsInput,
  type SetBrowserDevToolsVisibilityInput,
  type UpdateBrowserDevToolsBoundsInput,
} from '../../src/types/browser'
import {
  closeBrowserGuestDevTools,
  openBrowserGuestDevTools,
  setBrowserGuestDevToolsVisible,
  updateBrowserGuestDevToolsBounds,
} from '../window/createApplicationWindow'
import {
  clearCompletedKanbanBoardCards,
  createKanbanBoardCard,
  createKanbanBoardTask,
  deleteKanbanBoardCard,
  getKanbanBoardData,
  getKanbanCard,
  importKanbanBoardData,
  moveKanbanBoardCard,
  readKanbanBoardColumn,
  reorderKanbanBoardCard,
  updateKanbanBoardCard,
  updateKanbanBoardCardContent,
} from '../kanban/store'
import { generateKanbanTaskPlan } from '../kanban/planner'
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
  let browserDevToolsMenuOverlay: {
    onOwnerWindowBlur: () => void
    ownerWindow: BrowserWindow
    resolve: (mode: BrowserDevToolsDockMode | null) => void
    resolved: boolean
    view: WebContentsView
  } | null = null

  const closeBrowserDevToolsMenuOverlay = (mode: BrowserDevToolsDockMode | null = null) => {
    const overlay = browserDevToolsMenuOverlay
    if (!overlay || overlay.resolved) {
      return
    }

    overlay.resolved = true
    browserDevToolsMenuOverlay = null
    if (!overlay.ownerWindow.isDestroyed()) {
      overlay.ownerWindow.removeListener('blur', overlay.onOwnerWindowBlur)
      try {
        overlay.ownerWindow.contentView.removeChildView(overlay.view)
      } catch {
        // The owner window may be closing.
      }
    }
    if (!overlay.view.webContents.isDestroyed()) {
      overlay.view.webContents.close()
    }
    overlay.resolve(mode)
  }

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

  ipcMain.handle('browser:openDevTools', async (event, input: OpenBrowserDevToolsInput) => {
    if (
      !input ||
      !Number.isInteger(input.webContentsId) ||
      input.webContentsId <= 0 ||
      !isBrowserDevToolsDockMode(input.mode)
    ) {
      return false
    }

    const target = resolveBrowserGuest(event.sender.id, input.webContentsId)
    const activeWindow = getWindow()
    if (!target || !activeWindow || activeWindow.isDestroyed()) {
      return false
    }

    if (
      input.mode !== 'undocked' &&
      (!input.bounds ||
        !Number.isFinite(input.bounds.x) ||
        !Number.isFinite(input.bounds.y) ||
        !Number.isFinite(input.bounds.width) ||
        !Number.isFinite(input.bounds.height))
    ) {
      return false
    }

    await openBrowserGuestDevTools(target, input.mode, activeWindow, input.bounds)
    return true
  })
  ipcMain.handle('browser:showDevToolsDockMenu', async (event, input: BrowserDevToolsMenuInput) => {
    const activeWindow = getWindow()
    if (
      !activeWindow ||
      activeWindow.isDestroyed() ||
      activeWindow.webContents.id !== event.sender.id ||
      !input ||
      !isBrowserDevToolsDockMode(input.mode) ||
      !input.anchor ||
      !Number.isFinite(input.anchor.x) ||
      !Number.isFinite(input.anchor.y) ||
      !Number.isFinite(input.anchor.width) ||
      !Number.isFinite(input.anchor.height) ||
      !input.theme
    ) {
      return null
    }

    if (
      browserDevToolsMenuOverlay &&
      !browserDevToolsMenuOverlay.resolved &&
      browserDevToolsMenuOverlay.ownerWindow === activeWindow
    ) {
      closeBrowserDevToolsMenuOverlay()
      return null
    }

    const sanitizeColor = (value: unknown, fallback: string) => {
      if (typeof value !== 'string') {
        return fallback
      }
      const trimmed = value.trim()
      return trimmed && trimmed.length <= 160 ? trimmed : fallback
    }
    const escapeHtml = (value: string) => value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')

    const background = sanitizeColor(input.theme.background, '#171718')
    const border = sanitizeColor(input.theme.border, '#36363a')
    const foreground = sanitizeColor(input.theme.foreground, '#e7e7e7')
    const activeSurface = sanitizeColor(input.theme.activeSurface, '#223630')
    const hoverSurface = sanitizeColor(input.theme.hoverSurface, '#27272a')

    const contentBounds = activeWindow.getContentBounds()

    const popup = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    popup.setBackgroundColor('#00000000')
    popup.setVisible(false)
    activeWindow.contentView.addChildView(popup)
    popup.setBounds({
      x: 0,
      y: 0,
      width: contentBounds.width,
      height: contentBounds.height,
    })

    const menuRight = Math.max(
      8,
      Math.round(contentBounds.width - (input.anchor.x + input.anchor.width)),
    )
    const menuTop = Math.max(8, Math.round(input.anchor.y + input.anchor.height + 4))

    const options: Array<{ label: string; mode: BrowserDevToolsDockMode }> = [
      { label: 'Right sidebar', mode: 'right' },
      { label: 'Bottom', mode: 'bottom' },
      { label: 'Floating', mode: 'undocked' },
    ]
    const optionHtml = options.map((option) => {
      const active = option.mode === input.mode
      return [
        `<a class="option${active ? ' active' : ''}" href="https://tidecode.local/devtools/${option.mode}">`,
        `<span>${escapeHtml(option.label)}</span>`,
        '</a>',
      ].join('')
    }).join('')

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
    body { padding: 0; font-family: "Google Sans Flex", "Segoe UI", sans-serif; color: ${escapeHtml(foreground)}; }
    .backdrop {
      position: absolute;
      inset: 0;
      display: block;
      background: transparent;
    }
    .menu {
      position: absolute;
      z-index: 1;
      top: ${menuTop}px;
      right: ${menuRight}px;
      width: max-content;
      height: auto;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border: 1px solid ${escapeHtml(border)};
      border-radius: 12px;
      background: ${escapeHtml(background)};
    }
    .option {
      display: flex;
      height: 36px;
      flex: 0 0 36px;
      align-items: center;
      padding: 0 10px;
      border-radius: 8px;
      color: ${escapeHtml(foreground)};
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      user-select: none;
      white-space: nowrap;
    }
    .option:hover { background: ${escapeHtml(hoverSurface)}; }
    .option.active { background: ${escapeHtml(activeSurface)}; }
  </style>
</head>
<body>
  <a class="backdrop" href="https://tidecode.local/devtools/close" aria-label="Close DevTools menu"></a>
  <div class="menu">${optionHtml}</div>
</body>
</html>`

    return new Promise<BrowserDevToolsDockMode | null>((resolve) => {
      const onOwnerWindowBlur = () => finish(null)
      browserDevToolsMenuOverlay = {
        onOwnerWindowBlur,
        ownerWindow: activeWindow,
        resolve,
        resolved: false,
        view: popup,
      }
      activeWindow.on('blur', onOwnerWindowBlur)

      const finish = (mode: BrowserDevToolsDockMode | null) => {
        if (browserDevToolsMenuOverlay?.view !== popup) {
          return
        }
        closeBrowserDevToolsMenuOverlay(mode)
      }

      popup.webContents.on('will-navigate', (navigationEvent, url) => {
        const match = /^https:\/\/tidecode\.local\/devtools\/(right|bottom|undocked|close)$/u.exec(url)
        if (!match) {
          return
        }
        navigationEvent.preventDefault()
        const mode = match[1]
        finish(mode !== 'close' && isBrowserDevToolsDockMode(mode) ? mode : null)
      })
      popup.webContents.once('destroyed', () => {
        if (browserDevToolsMenuOverlay?.view === popup) {
          if (!activeWindow.isDestroyed()) {
            activeWindow.removeListener('blur', onOwnerWindowBlur)
          }
          browserDevToolsMenuOverlay.resolved = true
          browserDevToolsMenuOverlay = null
          resolve(null)
        }
      })
      void popup.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        .then(() => {
          if (!popup.webContents.isDestroyed() && browserDevToolsMenuOverlay?.view === popup) {
            popup.setVisible(true)
            popup.webContents.focus()
          }
        })
        .catch(() => finish(null))
    })
  })
  ipcMain.handle('browser:closeDevTools', async (event, input: BrowserDevToolsTargetInput) => {
    const target = resolveBrowserGuest(event.sender.id, input?.webContentsId)
    if (!target) {
      return false
    }
    closeBrowserGuestDevTools(target)
    return true
  })
  ipcMain.handle('browser:updateDevToolsBounds', async (event, input: UpdateBrowserDevToolsBoundsInput) => {
    const target = resolveBrowserGuest(event.sender.id, input?.webContentsId)
    if (
      !target ||
      !input.bounds ||
      !Number.isFinite(input.bounds.x) ||
      !Number.isFinite(input.bounds.y) ||
      !Number.isFinite(input.bounds.width) ||
      !Number.isFinite(input.bounds.height)
    ) {
      return false
    }
    return updateBrowserGuestDevToolsBounds(target.id, input.bounds)
  })
  ipcMain.handle('browser:setDevToolsVisible', async (event, input: SetBrowserDevToolsVisibilityInput) => {
    const target = resolveBrowserGuest(event.sender.id, input?.webContentsId)
    if (!target || typeof input.visible !== 'boolean') {
      return false
    }
    return setBrowserGuestDevToolsVisible(target.id, input.visible)
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
  ipcMain.handle('history:storeChatAttachment', async (_event, input) => storeChatAttachment(input))
  ipcMain.handle('history:listChatAttachments', async (_event, conversationId: string) =>
    listChatAttachments(conversationId),
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
  ipcMain.handle('kanban:getBoardData', async (_event, input: KanbanWorkspaceInput) => getKanbanBoardData(input))
  ipcMain.handle('kanban:importBoardData', async (_event, input: KanbanWorkspaceInput & { cards: unknown[] }) =>
    importKanbanBoardData(input as KanbanWorkspaceInput & KanbanBoardData),
  )
  ipcMain.handle('kanban:readBoard', async (_event, input: KanbanReadBoardRequest) => readKanbanBoardColumn(input))
  ipcMain.handle('kanban:readCard', async (_event, input: KanbanReadCardRequest) => getKanbanCard(input))
  ipcMain.handle('kanban:planTask', async (_event, input: KanbanTaskPlanInput) => generateKanbanTaskPlan(input))
  ipcMain.handle('kanban:createCard', async (_event, input: KanbanCreateCardRequest) => createKanbanBoardCard(input))
  ipcMain.handle('kanban:createTask', async (_event, input: KanbanCreateTaskRequest) => createKanbanBoardTask(input))
  ipcMain.handle('kanban:updateCardContent', async (_event, input: KanbanUpdateCardRequest) =>
    updateKanbanBoardCardContent(input),
  )
  ipcMain.handle('kanban:updateCard', async (_event, input: KanbanWorkspaceInput & KanbanUpdateCardInput) =>
    updateKanbanBoardCard(input),
  )
  ipcMain.handle('kanban:moveCard', async (_event, input: KanbanMoveCardRequest) => moveKanbanBoardCard(input))
  ipcMain.handle('kanban:reorderCard', async (_event, input: KanbanReorderCardRequest) =>
    reorderKanbanBoardCard(input),
  )
  ipcMain.handle('kanban:deleteCard', async (_event, input: KanbanDeleteCardRequest) => deleteKanbanBoardCard(input))
  ipcMain.handle('kanban:clearCompletedCards', async (_event, input: KanbanWorkspaceInput) =>
    clearCompletedKanbanBoardCards(input),
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
