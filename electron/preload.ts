import { ipcRenderer, contextBridge, webUtils } from 'electron'
import { parseInitialSettingsArg } from './settings/bootstrap'
import type {
  AppendConversationMessagesInput,
  ApiKeyProviderId,
  AppSettings,
  ChatProviderId,
  ChatStreamEvent,
  CompressChatHistoryInput,
  EstimateContextUsageInput,
  EchosphereChatApi,
  EchosphereGitApi,
  EchosphereKanbanApi,
  EchosphereModelsApi,
  EchosphereProvidersApi,
  EchosphereTerminalApi,
  GitCommitInput,
  GitFileStageBatchInput,
  GitHistoryCommitDetailsInput,
  GitHistoryPageInput,
  SaveApiKeyProviderInput,
  SaveCustomModelInput,
  RenameConversationFolderInput,
  ReorderConversationFolderInput,
  CreateConversationFolderInput,
  FolderMoveDirection,
  CreateConversationInput,
  CreateWorkspaceCheckpointInput,
  EchosphereHistoryApi,
  EchosphereSettingsApi,
  EchosphereWorkspaceApi,
  GitFileStageInput,
  GitSyncInput,
  ReplaceConversationMessagesInput,
  CloseTerminalSessionInput,
  CreateTerminalSessionInput,
  OpenExternalTerminalLinkInput,
  ResizeTerminalSessionInput,
  SubmitToolDecisionInput,
  StartChatStreamInput,
  WorkspaceExplorerImportEntryInput,
  WorkspaceExplorerChangeEvent,
  WorkspaceRefactorCandidatesInput,
  WorkspaceExplorerWatchChangesInput,
  WriteTerminalSessionInput,
} from '../src/types/chat'
import type { EchosphereMcpApi, McpAddServerInput, McpState } from '../src/types/mcp'
import type { EchosphereSkillsApi } from '../src/types/skills'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

const historyApi: EchosphereHistoryApi = {
  listConversations: () => ipcRenderer.invoke('history:list'),
  listFolders: () => ipcRenderer.invoke('history:listFolders'),
  getConversation: (conversationId: string) => ipcRenderer.invoke('history:get', conversationId),
  getUserMessageCheckpointHistory: (conversationId: string, messageId: string) =>
    ipcRenderer.invoke('history:getUserMessageCheckpointHistory', conversationId, messageId),
  createConversation: (input?: CreateConversationInput) => ipcRenderer.invoke('history:create', input),
  createFolder: (input: CreateConversationFolderInput) => ipcRenderer.invoke('history:createFolder', input),
  createFolderFromPath: (folderPath: string) => ipcRenderer.invoke('history:createFolderFromPath', folderPath),
  moveFolder: (folderId: string, direction: FolderMoveDirection) =>
    ipcRenderer.invoke('history:moveFolder', folderId, direction),
  reorderFolder: (input: ReorderConversationFolderInput) => ipcRenderer.invoke('history:reorderFolder', input),
  renameFolder: (input: RenameConversationFolderInput) => ipcRenderer.invoke('history:renameFolder', input),
  deleteFolder: (folderId: string) => ipcRenderer.invoke('history:deleteFolder', folderId),
  pickFolder: () => ipcRenderer.invoke('history:pickFolder'),
  openFolderPath: (folderPath: string) => ipcRenderer.invoke('history:openFolderPath', folderPath),
  appendMessages: (input: AppendConversationMessagesInput) => ipcRenderer.invoke('history:appendMessages', input),
  replaceMessages: (input: ReplaceConversationMessagesInput) =>
    ipcRenderer.invoke('history:replaceMessages', input),
  updateConversationTitle: (conversationId: string, title: string) =>
    ipcRenderer.invoke('history:updateTitle', conversationId, title),
  deleteConversation: (conversationId: string) => ipcRenderer.invoke('history:delete', conversationId),
}

const settingsApi: EchosphereSettingsApi = {
  getInitialSettings: () => parseInitialSettingsArg(process.argv),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (input: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', input),
}

const mcpApi: EchosphereMcpApi = {
  addServer: (input: McpAddServerInput, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:addServer', input, workspacePath),
  connectServer: (serverId: string, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:connectServer', serverId, workspacePath),
  disconnectServer: (serverId: string, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:disconnectServer', serverId, workspacePath),
  getState: (workspacePath?: string | null) => ipcRenderer.invoke('mcp:getState', workspacePath),
  onStateChange: (listener: (payload: { state: McpState; workspacePath: string | null }) => void) => {
    const wrappedListener = (_event: unknown, payload: { state: McpState; workspacePath: string | null }) =>
      listener(payload)
    ipcRenderer.on('mcp:stateChanged', wrappedListener)
    return () => {
      ipcRenderer.off('mcp:stateChanged', wrappedListener)
    }
  },
  removeServer: (serverId: string, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:removeServer', serverId, workspacePath),
  refreshServer: (serverId: string, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:refreshServer', serverId, workspacePath),
  updateServer: (serverId: string, input: McpAddServerInput, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:updateServer', serverId, input, workspacePath),
  toggleTool: (serverId: string, toolName: string, enabled: boolean, workspacePath?: string | null) =>
    ipcRenderer.invoke('mcp:toggleTool', serverId, toolName, enabled, workspacePath),
}

const skillsApi: EchosphereSkillsApi = {
  listSkills: (workspacePath?: string | null) => ipcRenderer.invoke('skills:list', workspacePath),
}

const providersApi: EchosphereProvidersApi = {
  getProvidersState: (hydrate = false) => ipcRenderer.invoke('providers:state', hydrate),
  addCodexAccountWithOAuth: () => ipcRenderer.invoke('providers:codex:addAccountOauth'),
  connectCodexWithOAuth: () => ipcRenderer.invoke('providers:codex:connectOauth'),
  disconnectCodex: () => ipcRenderer.invoke('providers:codex:disconnect'),
  onStateChange: (listener: () => void) => {
    const wrappedListener = () => listener()
    ipcRenderer.on('providers:stateChanged', wrappedListener)
    return () => {
      ipcRenderer.off('providers:stateChanged', wrappedListener)
    }
  },
  saveApiKeyProvider: (input: SaveApiKeyProviderInput) => ipcRenderer.invoke('providers:apikey:save', input),
  removeApiKeyProvider: (providerId: ApiKeyProviderId) =>
    ipcRenderer.invoke('providers:apikey:remove', providerId),
  switchCodexAccount: (accountKey: string) => ipcRenderer.invoke('providers:codex:switchAccount', accountKey),
}

const modelsApi: EchosphereModelsApi = {
  listCustomModels: () => ipcRenderer.invoke('models:custom:list'),
  listProviderModels: (providerId: ChatProviderId) => ipcRenderer.invoke('models:provider:list', providerId),
  saveCustomModel: (input: SaveCustomModelInput) => ipcRenderer.invoke('models:custom:save', input),
  removeCustomModel: (modelId: string) => ipcRenderer.invoke('models:custom:remove', modelId),
}

const chatApi: EchosphereChatApi = {
  cancelStream: (streamId: string) => ipcRenderer.invoke('chat:stream:cancel', streamId),
  compressConversation: (input: CompressChatHistoryInput) => ipcRenderer.invoke('chat:compressConversation', input),
  estimateContextUsage: (input: EstimateContextUsageInput) => ipcRenderer.invoke('chat:context-usage:estimate', input),
  onStreamEvent: (listener: (event: ChatStreamEvent) => void) => {
    const wrappedListener = (_event: unknown, payload: ChatStreamEvent) => listener(payload)
    ipcRenderer.on('chat:stream:event', wrappedListener)
    return () => {
      ipcRenderer.off('chat:stream:event', wrappedListener)
    }
  },
  submitToolDecision: (input: SubmitToolDecisionInput) => ipcRenderer.invoke('chat:stream:submitToolDecision', input),
  startStream: (input: StartChatStreamInput) => ipcRenderer.invoke('chat:stream:start', input),
}

const kanbanApi: EchosphereKanbanApi = {
  clearCompletedCards: (input) => ipcRenderer.invoke('kanban:clearCompletedCards', input),
  createCard: (input) => ipcRenderer.invoke('kanban:createCard', input),
  deleteCard: (input) => ipcRenderer.invoke('kanban:deleteCard', input),
  getBoardData: (input) => ipcRenderer.invoke('kanban:getBoardData', input),
  importBoardData: (input) => ipcRenderer.invoke('kanban:importBoardData', input),
  moveCard: (input) => ipcRenderer.invoke('kanban:moveCard', input),
  readBoard: (input) => ipcRenderer.invoke('kanban:readBoard', input),
  readCard: (input) => ipcRenderer.invoke('kanban:readCard', input),
  updateCard: (input) => ipcRenderer.invoke('kanban:updateCard', input),
  updateCardContent: (input) => ipcRenderer.invoke('kanban:updateCardContent', input),
}

const gitApi: EchosphereGitApi = {
  checkoutBranch: (input) => ipcRenderer.invoke('git:checkoutBranch', input),
  commit: (input: GitCommitInput) => ipcRenderer.invoke('git:commit', input),
  createAndCheckoutBranch: (input) => ipcRenderer.invoke('git:createAndCheckoutBranch', input),
  discardFileChanges: (input: GitFileStageInput) => ipcRenderer.invoke('git:discardFileChanges', input),
  getBranches: (workspacePath: string) => ipcRenderer.invoke('git:getBranches', workspacePath),
  getHistoryCommitDetails: (input: GitHistoryCommitDetailsInput) => ipcRenderer.invoke('git:getHistoryCommitDetails', input),
  getDiffs: (workspacePath: string) => ipcRenderer.invoke('git:getDiffs', workspacePath),
  getHistoryPage: (input: GitHistoryPageInput) => ipcRenderer.invoke('git:getHistoryPage', input),
  getStatus: (workspacePath: string) => ipcRenderer.invoke('git:getStatus', workspacePath),
  sync: (input: GitSyncInput) => ipcRenderer.invoke('git:sync', input),
  stageFiles: (input: GitFileStageBatchInput) => ipcRenderer.invoke('git:stageFiles', input),
  stageFile: (input: GitFileStageInput) => ipcRenderer.invoke('git:stageFile', input),
  unstageFiles: (input: GitFileStageBatchInput) => ipcRenderer.invoke('git:unstageFiles', input),
  unstageFile: (input: GitFileStageInput) => ipcRenderer.invoke('git:unstageFile', input),
}

const workspaceApi: EchosphereWorkspaceApi = {
  createCheckpoint: (input: CreateWorkspaceCheckpointInput) => ipcRenderer.invoke('workspace:checkpoint:create', input),
  createRedoCheckpointFromSource: (sourceCheckpointId: string) =>
    ipcRenderer.invoke('workspace:checkpoint:createRedoFromSource', sourceCheckpointId),
  createRedoCheckpointFromSources: (sourceCheckpointIds: string[]) =>
    ipcRenderer.invoke('workspace:checkpoint:createRedoFromSources', sourceCheckpointIds),
  createEntry: (input) => ipcRenderer.invoke('workspace:explorer:createEntry', input),
  deleteEntry: (input) => ipcRenderer.invoke('workspace:explorer:deleteEntry', input),
  importEntry: (input: WorkspaceExplorerImportEntryInput) =>
    ipcRenderer.invoke('workspace:explorer:importEntry', input),
  onExplorerChange: (listener: (event: WorkspaceExplorerChangeEvent) => void) => {
    const wrappedListener = (_event: unknown, payload: WorkspaceExplorerChangeEvent) => listener(payload)
    ipcRenderer.on('workspace:explorer:changed', wrappedListener)
    return () => {
      ipcRenderer.off('workspace:explorer:changed', wrappedListener)
    }
  },
  listDirectory: (input) => ipcRenderer.invoke('workspace:explorer:listDirectory', input),
  listRefactorCandidates: (input: WorkspaceRefactorCandidatesInput) =>
    ipcRenderer.invoke('workspace:refactorCandidates:list', input),
  readFile: (input) => ipcRenderer.invoke('workspace:explorer:readFile', input),
  renameEntry: (input) => ipcRenderer.invoke('workspace:explorer:renameEntry', input),
  unwatchExplorerChanges: (input: WorkspaceExplorerWatchChangesInput) =>
    ipcRenderer.invoke('workspace:explorer:unwatch', input),
  transferEntry: (input) => ipcRenderer.invoke('workspace:explorer:transferEntry', input),
  watchExplorerChanges: (input: WorkspaceExplorerWatchChangesInput) =>
    ipcRenderer.invoke('workspace:explorer:watch', input),
  writeFile: (input) => ipcRenderer.invoke('workspace:explorer:writeFile', input),
  restoreCheckpoint: (checkpointId: string) => ipcRenderer.invoke('workspace:checkpoint:restore', checkpointId),
  restoreCheckpointSequence: (checkpointIds: string[]) =>
    ipcRenderer.invoke('workspace:checkpoint:restoreSequence', checkpointIds),
}

const fileDropApi = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
}

const terminalApi: EchosphereTerminalApi = {
  closeSession: (input: CloseTerminalSessionInput) => ipcRenderer.invoke('terminal:closeSession', input),
  createSession: (input: CreateTerminalSessionInput) => ipcRenderer.invoke('terminal:createSession', input),
  openExternalLink: (input: OpenExternalTerminalLinkInput) => ipcRenderer.invoke('terminal:openExternalLink', input),
  onData: (listener) => {
    const wrappedListener = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('terminal:session:data', wrappedListener)
    return () => {
      ipcRenderer.off('terminal:session:data', wrappedListener)
    }
  },
  onExit: (listener) => {
    const wrappedListener = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('terminal:session:exit', wrappedListener)
    return () => {
      ipcRenderer.off('terminal:session:exit', wrappedListener)
    }
  },
  resizeSession: (input: ResizeTerminalSessionInput) => ipcRenderer.invoke('terminal:resizeSession', input),
  writeToSession: (input: WriteTerminalSessionInput) => ipcRenderer.invoke('terminal:writeToSession', input),
}

contextBridge.exposeInMainWorld('echosphereHistory', historyApi)
contextBridge.exposeInMainWorld('echosphereKanban', kanbanApi)
contextBridge.exposeInMainWorld('echosphereModels', modelsApi)
contextBridge.exposeInMainWorld('echosphereMcp', mcpApi)
contextBridge.exposeInMainWorld('echosphereSettings', settingsApi)
contextBridge.exposeInMainWorld('echosphereProviders', providersApi)
contextBridge.exposeInMainWorld('echosphereSkills', skillsApi)
contextBridge.exposeInMainWorld('echosphereChat', chatApi)
contextBridge.exposeInMainWorld('echosphereGit', gitApi)
contextBridge.exposeInMainWorld('echosphereFileDrop', fileDropApi)
contextBridge.exposeInMainWorld('echosphereWorkspace', workspaceApi)
contextBridge.exposeInMainWorld('echosphereTerminal', terminalApi)
