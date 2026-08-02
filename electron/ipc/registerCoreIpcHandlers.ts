import { dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type {
  ApiKeyProviderId,
  AppendConversationMessagesInput,
  AppSettings,
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
  appendStoredMessages,
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
  replaceStoredMessages,
  updateStoredConversationPinned,
  updateStoredConversationTitle,
} from '../history/store'
import { listCompactionMarkers } from '../chat/history/eventStore'
import { getDraftAgentContextPath } from '../history/paths'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import { applyTideCodeAppIcon } from '../window/branding'
import { applyWindowTheme } from '../window/theme'
import { createSkill, listAvailableSkills } from '../skills/service'
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

export function registerCoreIpcHandlers(getWindow: () => BrowserWindow | null) {
  // Synchronous channel: lets the renderer read the draft path on first paint without an async round-trip
  ipcMain.on('history:getDraftAgentContextPathSync', (event) => {
    event.returnValue = getDraftAgentContextPath()
  })
  ipcMain.handle('history:ensureDraftAgentContext', async () => ensureDraftAgentContextDirectory())
  ipcMain.handle('history:cleanupDraftAgentContext', async () => cleanupDraftAgentContextDirectory())
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
    const activeWindow = getWindow()
    const result = activeWindow
      ? await dialog.showOpenDialog(activeWindow, dialogOptions)
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
  ipcMain.handle('history:updateArchived', async (_event, conversationId: string, isArchived: boolean) =>
    updateStoredConversationArchived(conversationId, isArchived),
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

    const activeWindow = getWindow()
    if (activeWindow) {
      applyWindowTheme(activeWindow, nextSettings.appearance)
      applyTideCodeAppIcon(activeWindow)
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
}
