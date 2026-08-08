import { ipcRenderer, contextBridge, webUtils } from 'electron'
import { parseInitialSettingsArg } from './settings/bootstrap'
import type {
  AppendConversationMessagesInput,
  ApiKeyProviderId,
  AppSettings,
  ChatProviderId,
  ChatStreamEvent,
  CompactConversationInput,
  EstimateContextUsageInput,
  TideCodeChatApi,
  TideCodeGitApi,
  TideCodeKanbanApi,
  TideCodeModelsApi,
  TideCodeProvidersApi,
  TideCodeTerminalApi,
  GitCommitInput,
  GitFileStageBatchInput,
  GitHistoryCommitDetailsInput,
  GitHistoryPageInput,
  GitSourceControlChangeEvent,
  GitSourceControlWatchChangesInput,
  SaveApiKeyProviderInput,
  SaveCustomModelInput,
  RenameConversationFolderInput,
  ReorderConversationFolderInput,
  CreateConversationFolderInput,
  FolderMoveDirection,
  CreateConversationInput,
  CreateWorkspaceCheckpointInput,
  TideCodeHistoryApi,
  TideCodeSettingsApi,
  TideCodeWorkspaceApi,
  GitFileStageInput,
  GitDiffLoadOptions,
  GitHubAuthStatus,
  GitHubDeviceLoginResult,
  GitSyncInput,
  ReplaceConversationMessagesInput,
  GitPublishInput,

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
import type { TideCodeMcpApi, McpAddServerInput, McpState } from '../src/types/mcp'
import type { TideCodeSkillsApi } from '../src/types/skills'
import type { TideCodeUpdatesApi } from '../src/types/updates'

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

const historyApi: TideCodeHistoryApi = {
  getDraftAgentContextPathSync: () => ipcRenderer.sendSync('history:getDraftAgentContextPathSync') as string,
  ensureDraftAgentContext: () => ipcRenderer.invoke('history:ensureDraftAgentContext'),
  cleanupDraftAgentContext: () => ipcRenderer.invoke('history:cleanupDraftAgentContext'),
  listConversations: () => ipcRenderer.invoke('history:list'),
  listFolders: () => ipcRenderer.invoke('history:listFolders'),
  getConversation: (conversationId: string) => ipcRenderer.invoke('history:get', conversationId),
  listCompactionMarkers: (conversationId: string) => ipcRenderer.invoke('history:listCompactionMarkers', conversationId),
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
  updateConversationArchived: (conversationId: string, isArchived: boolean) =>
    ipcRenderer.invoke('history:updateArchived', conversationId, isArchived),
  updateConversationPinned: (conversationId: string, isPinned: boolean) =>
    ipcRenderer.invoke('history:updatePinned', conversationId, isPinned),
  deleteConversation: (conversationId: string) => ipcRenderer.invoke('history:delete', conversationId),
}

const settingsApi: TideCodeSettingsApi = {
  getInitialSettings: () => parseInitialSettingsArg(process.argv),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (input: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', input),
}

const updatesApi: TideCodeUpdatesApi = {
  checkForUpdates: () => ipcRenderer.invoke('updates:checkForUpdates'),
  downloadUpdate: (version: string) => ipcRenderer.invoke('updates:downloadUpdate', version),
  getCachedUpdate: () => ipcRenderer.invoke('updates:getCachedUpdate'),
  getCurrentVersion: () => ipcRenderer.invoke('updates:getCurrentVersion'),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('updates:stateChanged', wrappedListener)
    return () => {
      ipcRenderer.off('updates:stateChanged', wrappedListener)
    }
  },
  openLatestRelease: () => ipcRenderer.invoke('updates:openLatestRelease'),
  restartToUpdate: () => ipcRenderer.invoke('updates:restartToUpdate'),
}

const mcpApi: TideCodeMcpApi = {
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

const skillsApi: TideCodeSkillsApi = {
  createSkill: (input, workspacePath) => ipcRenderer.invoke('skills:createSkill', input, workspacePath),
  listSkills: (workspacePath?: string | null) => ipcRenderer.invoke('skills:list', workspacePath),
}

const providersApi: TideCodeProvidersApi = {
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
  removeCodexAccount: (accountKey: string) => ipcRenderer.invoke('providers:codex:removeAccount', accountKey),
  switchCodexAccount: (accountKey: string) => ipcRenderer.invoke('providers:codex:switchAccount', accountKey),
}

const modelsApi: TideCodeModelsApi = {
  listCustomModels: () => ipcRenderer.invoke('models:custom:list'),
  listProviderModels: (providerId: ChatProviderId) => ipcRenderer.invoke('models:provider:list', providerId),
  saveCustomModel: (input: SaveCustomModelInput) => ipcRenderer.invoke('models:custom:save', input),
  removeCustomModel: (modelId: string) => ipcRenderer.invoke('models:custom:remove', modelId),
}

const chatApi: TideCodeChatApi = {
  cancelStream: (streamId: string) => ipcRenderer.invoke('chat:stream:cancel', streamId),
  compactConversation: (input: CompactConversationInput) => ipcRenderer.invoke('chat:compactConversation', input),
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

const kanbanApi: TideCodeKanbanApi = {
  clearCompletedCards: (input) => ipcRenderer.invoke('kanban:clearCompletedCards', input),
  createCard: (input) => ipcRenderer.invoke('kanban:createCard', input),
  createTask: (input) => ipcRenderer.invoke('kanban:createTask', input),
  deleteCard: (input) => ipcRenderer.invoke('kanban:deleteCard', input),
  getBoardData: (input) => ipcRenderer.invoke('kanban:getBoardData', input),
  importBoardData: (input) => ipcRenderer.invoke('kanban:importBoardData', input),
  moveCard: (input) => ipcRenderer.invoke('kanban:moveCard', input),
  onBoardChange: (listener) => {
    const wrappedListener = (_event: unknown, payload: Parameters<typeof listener>[0]) => listener(payload)
    ipcRenderer.on('kanban:changed', wrappedListener)
    return () => {
      ipcRenderer.off('kanban:changed', wrappedListener)
    }
  },
  planTask: (input) => ipcRenderer.invoke('kanban:planTask', input),
  readBoard: (input) => ipcRenderer.invoke('kanban:readBoard', input),
  readCard: (input) => ipcRenderer.invoke('kanban:readCard', input),
  reorderCard: (input) => ipcRenderer.invoke('kanban:reorderCard', input),
  updateCard: (input) => ipcRenderer.invoke('kanban:updateCard', input),
  updateCardContent: (input) => ipcRenderer.invoke('kanban:updateCardContent', input),
}

const gitApi: TideCodeGitApi = {
  checkoutBranch: (input) => ipcRenderer.invoke('git:checkoutBranch', input),
  commit: (input: GitCommitInput) => ipcRenderer.invoke('git:commit', input),
  createAndCheckoutBranch: (input) => ipcRenderer.invoke('git:createAndCheckoutBranch', input),
  discardFileChanges: (input: GitFileStageInput) => ipcRenderer.invoke('git:discardFileChanges', input),
  getBranches: (workspacePath: string) => ipcRenderer.invoke('git:getBranches', workspacePath),
  getHistoryCommitDetails: (input: GitHistoryCommitDetailsInput) => ipcRenderer.invoke('git:getHistoryCommitDetails', input),
  getDiffs: (workspacePath: string, options?: GitDiffLoadOptions) =>
    ipcRenderer.invoke('git:getDiffs', { options, workspacePath }),
  getHistoryPage: (input: GitHistoryPageInput) => ipcRenderer.invoke('git:getHistoryPage', input),
  getGitHubAuthStatus: (): Promise<GitHubAuthStatus> => ipcRenderer.invoke('git:getGitHubAuthStatus'),
  connectGitHub: (): Promise<GitHubDeviceLoginResult> => ipcRenderer.invoke('git:connectGitHub'),
  completeGitHubDeviceLogin: (): Promise<GitHubAuthStatus> => ipcRenderer.invoke('git:completeGitHubDeviceLogin'),
  onSourceControlChange: (listener: (event: GitSourceControlChangeEvent) => void) => {
    const wrappedListener = (_event: unknown, payload: GitSourceControlChangeEvent) => listener(payload)
    ipcRenderer.on('git:sourceControl:changed', wrappedListener)
    return () => {
      ipcRenderer.off('git:sourceControl:changed', wrappedListener)
    }
  },
  getStatus: (workspacePath: string) => ipcRenderer.invoke('git:getStatus', workspacePath),
  sync: (input: GitSyncInput) => ipcRenderer.invoke('git:sync', input),
  unwatchSourceControlChanges: (input: GitSourceControlWatchChangesInput) =>
    ipcRenderer.invoke('git:sourceControl:unwatch', input),
  watchSourceControlChanges: (input: GitSourceControlWatchChangesInput) =>
    ipcRenderer.invoke('git:sourceControl:watch', input),
  stageFiles: (input: GitFileStageBatchInput) => ipcRenderer.invoke('git:stageFiles', input),
  stageFile: (input: GitFileStageInput) => ipcRenderer.invoke('git:stageFile', input),
  unstageFiles: (input: GitFileStageBatchInput) => ipcRenderer.invoke('git:unstageFiles', input),
  unstageFile: (input: GitFileStageInput) => ipcRenderer.invoke('git:unstageFile', input),
  initRepository: (workspacePath: string) => ipcRenderer.invoke('git:init', workspacePath),
  publishToGitHub: (input: GitPublishInput) => ipcRenderer.invoke('git:publishToGitHub', input),
}


const workspaceApi: TideCodeWorkspaceApi = {
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
  updateExplorerWatchPaths: (input: WorkspaceExplorerWatchChangesInput) =>
    ipcRenderer.invoke('workspace:explorer:updateWatchPaths', input),
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

const clipboardApi = {
  readFiles: () => ipcRenderer.invoke('clipboard:readFiles'),
}

const terminalApi: TideCodeTerminalApi = {
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

contextBridge.exposeInMainWorld('tidecodeHistory', historyApi)
contextBridge.exposeInMainWorld('tidecodeKanban', kanbanApi)
contextBridge.exposeInMainWorld('tidecodeModels', modelsApi)
contextBridge.exposeInMainWorld('tidecodeMcp', mcpApi)
contextBridge.exposeInMainWorld('tidecodeSettings', settingsApi)
contextBridge.exposeInMainWorld('tidecodeUpdates', updatesApi)
contextBridge.exposeInMainWorld('tidecodeProviders', providersApi)
contextBridge.exposeInMainWorld('tidecodeSkills', skillsApi)
contextBridge.exposeInMainWorld('tidecodeChat', chatApi)
contextBridge.exposeInMainWorld('tidecodeGit', gitApi)
contextBridge.exposeInMainWorld('tidecodeFileDrop', fileDropApi)
contextBridge.exposeInMainWorld('tidecodeClipboard', clipboardApi)
contextBridge.exposeInMainWorld('tidecodeWorkspace', workspaceApi)
contextBridge.exposeInMainWorld('tidecodeTerminal', terminalApi)
