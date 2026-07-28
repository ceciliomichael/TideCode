import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type OpenDialogOptions,
} from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type {
  ApiKeyProviderId,
  AppendConversationMessagesInput,
  AppSettings,
  CheckoutGitBranchInput,
  CloseTerminalSessionInput,
  CreateGitBranchInput,
  CompressChatHistoryInput,
  CreateTerminalSessionInput,
  CreateWorkspaceCheckpointInput,
  FolderMoveDirection,
  ReorderConversationFolderInput,
  WorkspaceExplorerCreateEntryInput,
  WorkspaceExplorerDeleteEntryInput,
  WorkspaceExplorerListDirectoryInput,
  WorkspaceRefactorCandidatesInput,
  WorkspaceExplorerReadFileInput,
  WorkspaceExplorerRenameEntryInput,
  WorkspaceExplorerTransferEntryInput,
  WorkspaceExplorerWriteFileInput,
  EstimateContextUsageInput,
  GitCommitInput,
  GitHistoryCommitDetailsInput,
  GitHistoryPageInput,
  GitFileStageInput,
  GitFileStageBatchInput,
  GitSyncInput,
  OpenExternalTerminalLinkInput,
  ResizeTerminalSessionInput,
  RenameConversationFolderInput,
  SaveCustomModelInput,
  StartChatStreamInput,
  CreateConversationFolderInput,
  CreateConversationInput,
  ReplaceConversationMessagesInput,
  ChatProviderId,
  SaveApiKeyProviderInput,
  SubmitToolDecisionInput,
  WorkspaceExplorerImportEntryInput,
  WorkspaceExplorerWatchChangesInput,
  WriteTerminalSessionInput,
} from '../src/types/chat'
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
} from '../src/lib/kanban'
import type { McpAddServerInput } from '../src/types/mcp'
import {
  appendStoredMessages,
  createStoredFolder,
  createStoredFolderFromPath,
  createStoredConversation,
  deleteStoredFolder,
  deleteStoredConversation,
  getStoredConversation,
  getStoredUserMessageCheckpointHistory,
  listStoredConversations,
  listStoredFolders,
  moveStoredFolder,
  reorderStoredFolder,
  renameStoredFolder,
  replaceStoredMessages,
  updateStoredConversationTitle,
  updateStoredConversationPinned,
} from './history/store'
import { flushStoredSettingsUpdates, getStoredSettings, updateStoredSettings } from './settings/store'
import { serializeInitialSettingsArg } from './settings/bootstrap'
import { applyWindowTheme, getTitleBarOverlay, getWindowBackgroundColor, syncNativeThemeSource } from './window/theme'
import { createSkill, listAvailableSkills } from './skills/service'
import {
  cancelCodexChatStream,
  estimateCodexContextUsage,
  compressCodexChatHistory,
  startCodexChatStream,
  submitCodexToolDecision,
} from './chat/codex/runtime'
import {
  cancelApiKeyChatStream,
  compressApiKeyChatHistory,
  estimateApiKeyContextUsage,
  startApiKeyChatStream,
  submitApiKeyToolDecision,
} from './chat/apiKey/runtime'
import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  discardGitFileChanges,
  getGitBranchState,
  getGitDiffSnapshot,
  getGitHistoryCommitDetails,
  getGitHistoryPage,
  getGitStatus,
  gitSync,
  gitCommit,
  initGitRepository,
  publishToGitHub,
  stageGitFiles,
  stageGitFile,
  unstageGitFiles,
  unstageGitFile,
} from './git/service'

import {
  closeAllTerminalSessions,
  closeTerminalSession,
  createTerminalSession,
  openExternalTerminalLink,
  resizeTerminalSession,
  writeToTerminalSession,
} from './terminal/service'
import {
  addCodexAccountWithOAuth,
  connectCodexWithOAuth,
  disconnectCodex,
  getProvidersState,
  initializeProvidersState,
  removeApiKeyProvider,
  removeCodexAccount,
  saveApiKeyProvider,
  switchCodexAccount,
} from './providers/service'
import { onProvidersStateChanged } from './providers/events'
import {
  listCustomModels,
  listProviderModels,
  removeCustomModel,
  saveCustomModel,
} from './models/service'
import {
  createWorkspaceCheckpoint,
  createWorkspaceRedoCheckpointFromSource,
  createWorkspaceRedoCheckpointFromSources,
  restoreWorkspaceCheckpoint,
  restoreWorkspaceCheckpointSequence,
} from './workspace/checkpoints'
import { getMcpServerManager } from './mcp/serverManager'
import {
  disposeWorkspaceExplorerWatchers,
  subscribeWorkspaceExplorerChanges,
  unsubscribeWorkspaceExplorerChanges,
} from './workspace/explorerWatch'
import { disposeKanbanBoardWatchers } from './kanban/watch'
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  listWorkspaceRefactorCandidates,
  readWorkspaceFile,
  renameWorkspaceEntry,
  importWorkspaceEntry,
  transferWorkspaceEntry,
  writeWorkspaceFile,
} from './workspace/explorer'
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
} from './kanban/store'
import { generateKanbanTaskPlan } from './kanban/planner'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

app.commandLine.appendSwitch(
  'disable-features',
  'OverlayScrollbar,OverlayScrollbars,FluentOverlayScrollbar,FluentScrollbars',
)

let win: BrowserWindow | null
const activeChatStreamProviders = new Map<string, StartChatStreamInput['providerId']>()
const mcpServerManager = getMcpServerManager()
onProvidersStateChanged(() => {
  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send('providers:stateChanged')
})

// --- Instance / profile isolation ---
//
// You may run a dev instance (Vite dev server) *and* a packaged/built instance at the same time.
// On Windows, Chromium's disk cache is sensitive to concurrent access; if both instances share the
// same profile directories, you'll see:
//   "Unable to move the cache: Access is denied (0x5)" / "Gpu Cache Creation failed"
//
// We solve this by giving dev and packaged runs distinct userData/cache directories.
const isDevInstance = Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged
if (isDevInstance) {
  const appDataPath = app.getPath('appData')
  const devUserDataPath = path.join(appDataPath, `${app.getName()}-dev`)
  app.setPath('userData', devUserDataPath)
  // Keep cache within the dev profile too (avoids sharing GPUCache/Code Cache/etc.).
  app.setPath('cache', path.join(devUserDataPath, 'Cache'))
}

// Prevent multiple running instances *within the same flavor* (dev or packaged) from contending
// over the same Chromium profile/cache.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  // Ensure we don't continue bootstrapping anything in this process.
  process.exit(0)
}

app.on('second-instance', () => {
  // Someone tried to run a second instance, focus our window instead.
  if (win) {
    if (win.isMinimized()) {
      win.restore()
    }
    win.show()
    win.focus()
    return
  }

  // If we don't currently have a window (e.g. it was closed), recreate it.
  void createWindow()
})

const MIN_WINDOW_WIDTH = 960
const MIN_WINDOW_HEIGHT = 680
let isQuitFlushInProgress = false

function getInitialWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay()

  return {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  }
}

async function createWindow() {
  const initialBounds = getInitialWindowBounds()
  const initialSettings = await getStoredSettings().catch(() => null)
  const initialAppearance = initialSettings?.appearance ?? 'system'
  const appIconPath = path.join(process.env.APP_ROOT, 'public', 'logo', 'icon.svg')
  syncNativeThemeSource(initialAppearance)
  const windowOptions: BrowserWindowConstructorOptions = {
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(initialAppearance),
    height: initialBounds.height,
    minHeight: MIN_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    show: false,
    title: 'EchoSphere',
    width: initialBounds.width,
    x: initialBounds.x,
    y: initialBounds.y,
    webPreferences: {
      additionalArguments: initialSettings ? [serializeInitialSettingsArg(initialSettings)] : [],
      preload: path.join(__dirname, 'preload.mjs'),
    },
  }

  if (existsSync(appIconPath)) {
    windowOptions.icon = appIconPath
  }

  if (process.platform === 'win32' || process.platform === 'linux') {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.titleBarOverlay = getTitleBarOverlay(initialAppearance)
  }

  win = new BrowserWindow(windowOptions)
  applyWindowTheme(win, initialAppearance)

  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    if (!win) {
      return
    }

    if (!win.isMaximized()) {
      win.maximize()
    }

    win.show()
  })

  // Handle external links: open in system browser instead of Electron popup
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const activeWindow = win
    if (!activeWindow) {
      return
    }

    // Prevent in-app navigation to external URLs
    if (url !== activeWindow.webContents.getURL()) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerHistoryHandlers() {
  ipcMain.handle('history:list', async () => listStoredConversations())
  ipcMain.handle('history:listFolders', async () => listStoredFolders())
  ipcMain.handle('history:get', async (_event, conversationId: string) => getStoredConversation(conversationId))
  ipcMain.handle('history:getUserMessageCheckpointHistory', async (_event, conversationId: string, messageId: string) =>
    getStoredUserMessageCheckpointHistory(conversationId, messageId),
  )
  ipcMain.handle('history:create', async (_event, input?: CreateConversationInput) => createStoredConversation(input))
  ipcMain.handle('history:createFolder', async (_event, input: CreateConversationFolderInput) =>
    createStoredFolder(input),
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
  ipcMain.handle('history:deleteFolder', async (_event, folderId: string) => deleteStoredFolder(folderId))
  ipcMain.handle('history:pickFolder', async () => {
    const dialogOptions: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select folder',
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return createStoredFolderFromPath(result.filePaths[0])
  })
  ipcMain.handle('history:createFolderFromPath', async (_event, folderPath: string) =>
    createStoredFolderFromPath(folderPath),
  )
  ipcMain.handle('history:openFolderPath', async (_event, folderPath: string) => {
    await shell.openPath(folderPath)
  })
  ipcMain.handle('history:appendMessages', async (_event, input: AppendConversationMessagesInput) =>
    appendStoredMessages(input),
  )
  ipcMain.handle('history:replaceMessages', async (_event, input: ReplaceConversationMessagesInput) =>
    replaceStoredMessages(input),
  )
  ipcMain.handle('history:updateTitle', async (_event, conversationId: string, title: string) =>
    updateStoredConversationTitle(conversationId, title),
  )
  ipcMain.handle('history:updatePinned', async (_event, conversationId: string, isPinned: boolean) =>
    updateStoredConversationPinned(conversationId, isPinned),
  )
  ipcMain.handle('history:delete', async (_event, conversationId: string) =>
    deleteStoredConversation(conversationId),
  )
  ipcMain.handle('settings:get', async () => getStoredSettings())
  ipcMain.handle('settings:update', async (_event, input: Partial<AppSettings>) => {
    const nextSettings = await updateStoredSettings(input)

    if (win) {
      applyWindowTheme(win, nextSettings.appearance)
    }

    return nextSettings
  })
  ipcMain.handle('skills:list', async (_event, workspacePath?: string | null) => listAvailableSkills(workspacePath))
  ipcMain.handle('skills:createSkill', async (_event, input: Parameters<typeof createSkill>[0], workspacePath?: string | null) =>
    createSkill(input, workspacePath),
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
  ipcMain.handle('chat:stream:start', async (event, input: StartChatStreamInput) => {
    if (input.providerId === 'codex') {
      const result = await startCodexChatStream(event.sender, input, () => {
        activeChatStreamProviders.delete(result.streamId)
      })
      activeChatStreamProviders.set(result.streamId, input.providerId)
      return result
    }

    const result = await startApiKeyChatStream(event.sender, input, () => {
      activeChatStreamProviders.delete(result.streamId)
    })
    activeChatStreamProviders.set(result.streamId, input.providerId)
    return result
  })
  ipcMain.handle('chat:stream:cancel', async (_event, streamId: string) => {
    const providerId = activeChatStreamProviders.get(streamId)
    activeChatStreamProviders.delete(streamId)

    if (providerId === 'codex') {
      await cancelCodexChatStream(streamId)
      return
    }

    if (providerId) {
      await cancelApiKeyChatStream(streamId)
      return
    }

    await Promise.all([cancelCodexChatStream(streamId), cancelApiKeyChatStream(streamId)])
  })
  ipcMain.handle('chat:compressConversation', async (_event, input: CompressChatHistoryInput) => {
    if (input.providerId === 'codex') {
      return compressCodexChatHistory(input)
    }

    return compressApiKeyChatHistory(input)
  })
  ipcMain.handle('chat:stream:submitToolDecision', async (_event, input: SubmitToolDecisionInput) => {
    const providerId = activeChatStreamProviders.get(input.streamId)

    if (providerId === 'codex') {
      return submitCodexToolDecision(input)
    }

    if (providerId) {
      return submitApiKeyToolDecision(input)
    }

    throw new Error('Unable to determine which provider owns this tool decision stream.')
  })
  ipcMain.handle('chat:context-usage:estimate', async (event, input: EstimateContextUsageInput) => {
    if (input.providerId === 'codex') {
      return estimateCodexContextUsage(event.sender, input)
    }

    return estimateApiKeyContextUsage(event.sender, input)
  })
  ipcMain.handle('terminal:createSession', async (event, input: CreateTerminalSessionInput) =>
    createTerminalSession(event, input),
  )
  ipcMain.handle('terminal:writeToSession', async (event, input: WriteTerminalSessionInput) =>
    writeToTerminalSession(event, input),
  )
  ipcMain.handle('terminal:resizeSession', async (event, input: ResizeTerminalSessionInput) =>
    resizeTerminalSession(event, input),
  )
  ipcMain.handle('terminal:closeSession', async (event, input: CloseTerminalSessionInput) =>
    closeTerminalSession(event, input),
  )
  ipcMain.handle('terminal:openExternalLink', async (_event, input: OpenExternalTerminalLinkInput) =>
    openExternalTerminalLink(input),
  )
  ipcMain.handle('git:getBranches', async (_event, workspacePath: string) => getGitBranchState(workspacePath))
  ipcMain.handle('git:getDiffs', async (_event, workspacePath: string) => getGitDiffSnapshot(workspacePath))
  ipcMain.handle('git:getHistoryCommitDetails', async (_event, input: GitHistoryCommitDetailsInput) =>
    getGitHistoryCommitDetails(input),
  )
  ipcMain.handle('git:getHistoryPage', async (_event, input: GitHistoryPageInput) => getGitHistoryPage(input))
  ipcMain.handle('git:discardFileChanges', async (_event, input: GitFileStageInput) => discardGitFileChanges(input))
  ipcMain.handle('git:checkoutBranch', async (_event, input: CheckoutGitBranchInput) => checkoutGitBranch(input))
  ipcMain.handle('git:createAndCheckoutBranch', async (_event, input: CreateGitBranchInput) =>
    createAndCheckoutGitBranch(input),
  )
  ipcMain.handle('git:commit', async (_event, input: GitCommitInput) => gitCommit(input))
  ipcMain.handle('git:sync', async (_event, input: GitSyncInput) => gitSync(input))
  ipcMain.handle('git:getStatus', async (_event, workspacePath: string) => getGitStatus(workspacePath))
  ipcMain.handle('git:stageFile', async (_event, input: GitFileStageInput) => stageGitFile(input))
  ipcMain.handle('git:stageFiles', async (_event, input: GitFileStageBatchInput) => stageGitFiles(input))
  ipcMain.handle('git:unstageFile', async (_event, input: GitFileStageInput) => unstageGitFile(input))
  ipcMain.handle('git:unstageFiles', async (_event, input: GitFileStageBatchInput) => unstageGitFiles(input))
  ipcMain.handle('git:init', async (_event, workspacePath: string) => initGitRepository(workspacePath))
  ipcMain.handle('git:publishToGitHub', async (_event, input) => publishToGitHub(input))

  ipcMain.handle('workspace:checkpoint:create', async (_event, input: CreateWorkspaceCheckpointInput) =>
    createWorkspaceCheckpoint(input),
  )
  ipcMain.handle('workspace:checkpoint:restore', async (_event, checkpointId: string) =>
    restoreWorkspaceCheckpoint(checkpointId),
  )
  ipcMain.handle('workspace:checkpoint:createRedoFromSource', async (_event, sourceCheckpointId: string) =>
    createWorkspaceRedoCheckpointFromSource(sourceCheckpointId),
  )
  ipcMain.handle('workspace:checkpoint:createRedoFromSources', async (_event, sourceCheckpointIds: string[]) =>
    createWorkspaceRedoCheckpointFromSources(sourceCheckpointIds),
  )
  ipcMain.handle('workspace:checkpoint:restoreSequence', async (_event, checkpointIds: string[]) =>
    restoreWorkspaceCheckpointSequence(checkpointIds),
  )
  ipcMain.handle('workspace:explorer:watch', async (event, input: WorkspaceExplorerWatchChangesInput) =>
    subscribeWorkspaceExplorerChanges(event.sender, input.workspaceRootPath),
  )
  ipcMain.handle('workspace:explorer:unwatch', async (event, input: WorkspaceExplorerWatchChangesInput) =>
    unsubscribeWorkspaceExplorerChanges(event.sender.id, input.workspaceRootPath),
  )
  ipcMain.handle('workspace:explorer:listDirectory', async (_event, input: WorkspaceExplorerListDirectoryInput) =>
    listWorkspaceDirectory(input),
  )
  ipcMain.handle('workspace:refactorCandidates:list', async (_event, input: WorkspaceRefactorCandidatesInput) =>
    listWorkspaceRefactorCandidates(input),
  )
  ipcMain.handle('workspace:explorer:readFile', async (_event, input: WorkspaceExplorerReadFileInput) =>
    readWorkspaceFile(input),
  )
  ipcMain.handle('workspace:explorer:writeFile', async (_event, input: WorkspaceExplorerWriteFileInput) =>
    writeWorkspaceFile(input),
  )
  ipcMain.handle('workspace:explorer:createEntry', async (_event, input: WorkspaceExplorerCreateEntryInput) =>
    createWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:renameEntry', async (_event, input: WorkspaceExplorerRenameEntryInput) =>
    renameWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:deleteEntry', async (_event, input: WorkspaceExplorerDeleteEntryInput) =>
    deleteWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:transferEntry', async (_event, input: WorkspaceExplorerTransferEntryInput) =>
    transferWorkspaceEntry(input),
  )
  ipcMain.handle('workspace:explorer:importEntry', async (_event, input: WorkspaceExplorerImportEntryInput) =>
    importWorkspaceEntry(input),
  )
  ipcMain.handle('clipboard:readFiles', async () => {
    if (process.platform === 'win32') {
      const raw = clipboard.readBuffer('FileNameW')
      if (!raw || raw.length === 0) {
        return []
      }
      const pathStr = raw.toString('utf16le')
      const paths = pathStr.split('\0').filter(s => s.trim().length > 0)
      return paths
    }

    if (process.platform === 'darwin') {
      const url = clipboard.read('public.file-url')
      if (url && url.startsWith('file://')) {
        return [decodeURIComponent(url.replace('file://', ''))]
      }
      return []
    }

    const url = clipboard.read('text/uri-list')
    if (url) {
      return url.split('\n').filter(s => s.startsWith('file://')).map(s => decodeURIComponent(s.replace('file://', '').trim()))
    }
    return []
  })
}

function registerMcpHandlers() {
  ipcMain.handle('mcp:getState', async (_event, workspacePath?: string | null) =>
    mcpServerManager.getState(workspacePath),
  )
  ipcMain.handle('mcp:addServer', async (_event, input: McpAddServerInput, workspacePath?: string | null) =>
    mcpServerManager.addServer(input, workspacePath),
  )
  ipcMain.handle('mcp:updateServer', async (_event, serverId: string, input: McpAddServerInput, workspacePath?: string | null) =>
    mcpServerManager.updateServer(serverId, input, workspacePath),
  )
  ipcMain.handle('mcp:connectServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.connectServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:disconnectServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.disconnectServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:removeServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.removeServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:refreshServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.refreshServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:toggleTool', async (_event, serverId: string, toolName: string, enabled: boolean, workspacePath?: string | null) =>
    mcpServerManager.toggleTool(serverId, toolName, enabled, workspacePath),
  )
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    disposeWorkspaceExplorerWatchers()
    disposeKanbanBoardWatchers()
    app.quit()
    win = null
  }
})

app.on('before-quit', (event) => {
  if (isQuitFlushInProgress) {
    return
  }

  event.preventDefault()
  isQuitFlushInProgress = true
  disposeWorkspaceExplorerWatchers()
  disposeKanbanBoardWatchers()
  void closeAllTerminalSessions().catch((error) => {
    console.error('Failed to close terminal sessions on quit', error)
  })
  void flushStoredSettingsUpdates()
    .catch((error) => {
      console.error('Failed to flush settings updates on quit', error)
    })
    .finally(() =>
      mcpServerManager
        .dispose()
        .catch((error) => {
          console.error('Failed to dispose MCP manager on quit', error)
        })
        .finally(() => {
          app.quit()
        }),
    )
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  registerHistoryHandlers()
  registerMcpHandlers()
  mcpServerManager.onStateChange(({ state, workspacePath }) => {
    const currentWindow = win
    if (!currentWindow) {
      return
    }

    currentWindow.webContents.send('mcp:stateChanged', {
      state,
      workspacePath,
    })
  })

  void initializeProvidersState().catch((error) => {
    console.error('Failed to preload providers state', error)
  })

  void createWindow()

  nativeTheme.on('updated', () => {
    const currentWindow = win

    if (!currentWindow) {
      return
    }

    void getStoredSettings()
      .then((settings) => {
        if (settings.appearance === 'system') {
          applyWindowTheme(currentWindow, settings.appearance)
        }
      })
      .catch((error) => {
        console.error('Failed to sync native theme', error)
      })
  })
})
