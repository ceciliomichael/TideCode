import type {
  KanbanBoardData,
  KanbanCard,
  KanbanCardDetails,
  KanbanColumnReadResult,
  KanbanCreateCardRequest,
  KanbanCreateTaskRequest,
  KanbanCreateTaskResult,
  KanbanDeleteCardRequest,
  KanbanMoveCardRequest,
  KanbanReadBoardRequest,
  KanbanReadCardRequest,
  KanbanReorderCardRequest,
  KanbanTaskPlan,
  KanbanTaskPlanInput,
  KanbanUpdateCardInput,
  KanbanUpdateCardRequest,
  KanbanWorkspaceInput,
} from '../../lib/kanban'
import type {
  AppendConversationMessagesInput,
  ConversationFolderRecord,
  ConversationFolderSummary,
  ConversationRecord,
  ProjectFolderPrunedEvent,
  ConversationSummary,
  CreateConversationFolderInput,
  CreateConversationInput,
  FolderMoveDirection,
  RenameConversationFolderInput,
  ReorderConversationFolderInput,
  ReplaceConversationMessagesInput,
  UserMessageRunCheckpoint,
} from './conversations'
import type {
  CheckoutGitBranchInput,
  CreateGitBranchInput,
  GitBranchState,
  GitCommitInput,
  GitCommitResult,
  GitDiffLoadOptions,
  GitDiffSnapshot,
  GitFileStageBatchInput,
  GitFileStageBatchResult,
  GitFileStageInput,
  GitFileStageResult,
  GitHistoryCommitDetailsInput,
  GitHistoryCommitDetailsResult,
  GitHistoryPageInput,
  GitHistoryPageResult,
  GitHubAuthStatus,
  GitHubDeviceLoginResult,
  GitInitResult,
  GitPublishInput,
  GitPublishRemoteInput,
  GitPublishRemoteResult,
  GitPublishResult,
  GitStatusResult,
  GitSourceControlChangeEvent,
  GitSourceControlWatchChangesInput,
  GitSyncInput,
  GitSyncResult,
} from './git'
import type {
  ApiKeyProviderId,
  ChatProviderId,
  CustomModelConfig,
  ProviderModelConfig,
  ProvidersState,
  SaveApiKeyProviderInput,
  SaveCustomModelInput,
} from './providers'
import type {
  ChatCompactionMarker,
  ChatStreamEvent,
  CompactConversationInput,
  CompactConversationResult,
  ContextUsageEstimate,
  EstimateContextUsageInput,
  StartChatStreamInput,
  StartChatStreamResult,
  UpdatePendingSteerMessagesInput,
  UpdatePendingSteerMessagesResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from './runtime'
import type { AppSettings } from './settings'
import type { TideCodeLaunchRequest } from '../../lib/appLaunchRequest'
import type {
  CloseTerminalSessionInput,
  CreateTerminalSessionInput,
  CreateTerminalSessionResult,
  CreateWorkspaceCheckpointInput,
  OpenExternalTerminalLinkInput,
  ResizeTerminalSessionInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalTabClosedEvent,
  WorkspaceExplorerChangeEvent,
  WorkspaceExplorerCreateEntryInput,
  WorkspaceExplorerCreateEntryResult,
  WorkspaceExplorerDeleteEntryInput,
  WorkspaceExplorerDeleteEntryResult,
  WorkspaceExplorerEntry,
  WorkspaceExplorerImportEntryInput,
  WorkspaceExplorerImportEntryResult,
  WorkspaceExplorerListDirectoryInput,
  WorkspaceExplorerPasteClipboardImageInput,
  WorkspaceExplorerPasteClipboardImageResult,
  WorkspaceExplorerReadFileInput,
  WorkspaceExplorerReadFileResult,
  WorkspaceTypeScriptProjectInput,
  WorkspaceTypeScriptProjectSnapshot,
  WorkspaceExplorerRenameEntryInput,
  WorkspaceExplorerRenameEntryResult,
  WorkspaceExplorerTransferEntryInput,
  WorkspaceExplorerTransferEntryResult,
  WorkspaceExplorerWatchChangesInput,
  WorkspaceExplorerWriteFileInput,
  WorkspaceExplorerWriteFileResult,
  WorkspaceRefactorCandidate,
  WorkspaceRefactorCandidatesInput,
  WriteTerminalSessionInput,
} from './workspace'

export interface RemoteHistoryChangeEvent {
  activateConversation: boolean
  conversationId: string | null
  method: string
}

export interface TideCodeHistoryApi {
  getDraftAgentContextPathSync: () => string
  ensureDraftAgentContext: () => Promise<string>
  cleanupDraftAgentContext: () => Promise<void>
  listConversations: () => Promise<ConversationSummary[]>
  listFolders: () => Promise<ConversationFolderSummary[]>
  onProjectFolderPruned: (listener: (event: ProjectFolderPrunedEvent) => void) => () => void
  onRemoteChange: (listener: (event: RemoteHistoryChangeEvent) => void) => () => void
  getConversation: (conversationId: string) => Promise<ConversationRecord | null>
  listCompactionMarkers: (conversationId: string) => Promise<ChatCompactionMarker[]>
  getUserMessageCheckpointHistory: (conversationId: string, messageId: string) => Promise<UserMessageRunCheckpoint[]>
  createConversation: (input?: CreateConversationInput) => Promise<ConversationRecord>
  createFolder: (input: CreateConversationFolderInput) => Promise<ConversationFolderRecord>
  createFolderFromPath: (folderPath: string) => Promise<ConversationFolderRecord>
  moveFolder: (folderId: string, direction: FolderMoveDirection) => Promise<ConversationFolderRecord>
  reorderFolder: (input: ReorderConversationFolderInput) => Promise<ConversationFolderRecord>
  renameFolder: (input: RenameConversationFolderInput) => Promise<ConversationFolderRecord>
  deleteFolder: (folderId: string) => Promise<string[]>
  pickFolder: () => Promise<ConversationFolderRecord | null>
  openFolderPath: (folderPath: string) => Promise<void>
  appendMessages: (input: AppendConversationMessagesInput) => Promise<ConversationRecord>
  replaceMessages: (input: ReplaceConversationMessagesInput) => Promise<ConversationRecord>
  updateConversationTitle: (conversationId: string, title: string) => Promise<ConversationRecord>
  deleteConversation: (conversationId: string) => Promise<void>
  updateConversationArchived: (conversationId: string, isArchived: boolean) => Promise<ConversationRecord>
  updateConversationPinned: (conversationId: string, isPinned: boolean) => Promise<ConversationRecord>
}

export interface TideCodeSettingsApi {
  getInitialSettings: () => AppSettings
  getSettings: () => Promise<AppSettings>
  onRemoteChange: (listener: (settings: AppSettings) => void) => () => void
  updateSettings: (input: Partial<AppSettings>) => Promise<AppSettings>
}

export interface TideCodeAppApi {
  consumeApiKeyHandoff: (token: string) => Promise<string | null>
  getInitialLaunchRequest: () => TideCodeLaunchRequest | null
  onLaunchRequest: (listener: (request: TideCodeLaunchRequest) => void) => () => void
}

export interface TideCodeProvidersApi {
  getProvidersState: (hydrate?: boolean) => Promise<ProvidersState>
  addCodexAccountWithOAuth: () => Promise<ProvidersState>
  connectCodexWithOAuth: () => Promise<ProvidersState>
  disconnectCodex: () => Promise<ProvidersState>
  onStateChange: (listener: () => void) => () => void
  removeApiKeyProvider: (providerId: ApiKeyProviderId) => Promise<ProvidersState>
  saveApiKeyProvider: (input: SaveApiKeyProviderInput) => Promise<ProvidersState>
  removeCodexAccount: (accountKey: string) => Promise<ProvidersState>
  switchCodexAccount: (accountKey: string) => Promise<ProvidersState>
}

export interface TideCodeModelsApi {
  listCustomModels: () => Promise<CustomModelConfig[]>
  listProviderModels: (providerId: ChatProviderId) => Promise<ProviderModelConfig[]>
  removeCustomModel: (modelId: string) => Promise<CustomModelConfig[]>
  saveCustomModel: (input: SaveCustomModelInput) => Promise<CustomModelConfig[]>
}

export interface TideCodeChatApi {
  cancelStream: (streamId: string) => Promise<void>
  compactConversation: (input: CompactConversationInput) => Promise<CompactConversationResult>
  estimateContextUsage: (input: EstimateContextUsageInput) => Promise<ContextUsageEstimate>
  onStreamEvent: (listener: (event: ChatStreamEvent) => void) => () => void
  submitToolDecision: (input: SubmitToolDecisionInput) => Promise<SubmitToolDecisionResult>
  startStream: (input: StartChatStreamInput) => Promise<StartChatStreamResult>
  updatePendingSteerMessages: (
    input: UpdatePendingSteerMessagesInput,
  ) => Promise<UpdatePendingSteerMessagesResult>
}

export interface TideCodeKanbanApi {
  clearCompletedCards: (input: KanbanWorkspaceInput) => Promise<KanbanBoardData>
  createCard: (input: KanbanCreateCardRequest) => Promise<KanbanCard>
  createTask: (input: KanbanCreateTaskRequest) => Promise<KanbanCreateTaskResult>
  deleteCard: (input: KanbanDeleteCardRequest) => Promise<KanbanBoardData>
  getBoardData: (input: KanbanWorkspaceInput) => Promise<KanbanBoardData>
  importBoardData: (input: KanbanWorkspaceInput & KanbanBoardData) => Promise<KanbanBoardData>
  moveCard: (input: KanbanMoveCardRequest) => Promise<KanbanCard>
  onBoardChange: (listener: (event: KanbanBoardChangeEvent) => void) => () => void
  planTask: (input: KanbanTaskPlanInput) => Promise<KanbanTaskPlan>
  readBoard: (input: KanbanReadBoardRequest) => Promise<KanbanColumnReadResult>
  readCard: (input: KanbanReadCardRequest) => Promise<KanbanCardDetails | null>
  reorderCard: (input: KanbanReorderCardRequest) => Promise<KanbanCard>
  updateCard: (input: KanbanWorkspaceInput & KanbanUpdateCardInput) => Promise<KanbanCard>
  updateCardContent: (input: KanbanUpdateCardRequest) => Promise<KanbanCard>
}

export interface TideCodeWorkspaceApi {
  createCheckpoint: (input: CreateWorkspaceCheckpointInput) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSource: (sourceCheckpointId: string) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSources: (sourceCheckpointIds: string[]) => Promise<UserMessageRunCheckpoint>
  createEntry: (input: WorkspaceExplorerCreateEntryInput) => Promise<WorkspaceExplorerCreateEntryResult>
  deleteEntry: (input: WorkspaceExplorerDeleteEntryInput) => Promise<WorkspaceExplorerDeleteEntryResult>
  importEntry: (input: WorkspaceExplorerImportEntryInput) => Promise<WorkspaceExplorerImportEntryResult>
  pasteClipboardImage: (
    input: WorkspaceExplorerPasteClipboardImageInput,
  ) => Promise<WorkspaceExplorerPasteClipboardImageResult | null>
  listRefactorCandidates: (input: WorkspaceRefactorCandidatesInput) => Promise<WorkspaceRefactorCandidate[]>
  onExplorerChange: (listener: (event: WorkspaceExplorerChangeEvent) => void) => () => void
  listDirectory: (input: WorkspaceExplorerListDirectoryInput) => Promise<WorkspaceExplorerEntry[]>
  readFile: (input: WorkspaceExplorerReadFileInput) => Promise<WorkspaceExplorerReadFileResult>
  getTypeScriptProject: (input: WorkspaceTypeScriptProjectInput) => Promise<WorkspaceTypeScriptProjectSnapshot>
  renameEntry: (input: WorkspaceExplorerRenameEntryInput) => Promise<WorkspaceExplorerRenameEntryResult>
  updateExplorerWatchPaths: (input: WorkspaceExplorerWatchChangesInput) => Promise<void>
  unwatchExplorerChanges: (input: WorkspaceExplorerWatchChangesInput) => Promise<void>
  transferEntry: (input: WorkspaceExplorerTransferEntryInput) => Promise<WorkspaceExplorerTransferEntryResult>
  watchExplorerChanges: (input: WorkspaceExplorerWatchChangesInput) => Promise<void>
  writeFile: (input: WorkspaceExplorerWriteFileInput) => Promise<WorkspaceExplorerWriteFileResult>
  restoreCheckpoint: (checkpointId: string) => Promise<void>
  restoreCheckpointSequence: (checkpointIds: string[]) => Promise<void>
}

export interface KanbanBoardChangeEvent {
  workspaceRootPath: string
}

export interface TideCodeTerminalApi {
  closeSession: (input: CloseTerminalSessionInput) => Promise<void>
  createSession: (input: CreateTerminalSessionInput) => Promise<CreateTerminalSessionResult>
  openExternalLink: (input: OpenExternalTerminalLinkInput) => Promise<void>
  onData: (listener: (event: TerminalDataEvent) => void) => () => void
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void
  onTabClosed: (listener: (event: TerminalTabClosedEvent) => void) => () => void
  resizeSession: (input: ResizeTerminalSessionInput) => Promise<void>
  writeToSession: (input: WriteTerminalSessionInput) => Promise<void>
}

export interface TideCodeGitApi {
  checkoutBranch: (input: CheckoutGitBranchInput) => Promise<GitBranchState>
  commit: (input: GitCommitInput) => Promise<GitCommitResult>
  createAndCheckoutBranch: (input: CreateGitBranchInput) => Promise<GitBranchState>
  discardFileChanges: (input: GitFileStageInput) => Promise<GitFileStageResult>
  getBranches: (workspacePath: string) => Promise<GitBranchState>
  getHistoryCommitDetails: (input: GitHistoryCommitDetailsInput) => Promise<GitHistoryCommitDetailsResult>
  getDiffs: (workspacePath: string, options?: GitDiffLoadOptions) => Promise<GitDiffSnapshot>
  getHistoryPage: (input: GitHistoryPageInput) => Promise<GitHistoryPageResult>
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>
  connectGitHub: () => Promise<GitHubDeviceLoginResult>
  completeGitHubDeviceLogin: () => Promise<GitHubAuthStatus>
  onSourceControlChange: (listener: (event: GitSourceControlChangeEvent) => void) => () => void
  getStatus: (workspacePath: string) => Promise<GitStatusResult>
  initRepository: (workspacePath: string) => Promise<GitInitResult>
  publishToGitHub: (input: GitPublishInput) => Promise<GitPublishResult>
  publishToRemote: (input: GitPublishRemoteInput) => Promise<GitPublishRemoteResult>
  unwatchSourceControlChanges: (input: GitSourceControlWatchChangesInput) => Promise<void>
  sync: (input: GitSyncInput) => Promise<GitSyncResult>
  watchSourceControlChanges: (input: GitSourceControlWatchChangesInput) => Promise<void>
  stageFiles: (input: GitFileStageBatchInput) => Promise<GitFileStageBatchResult>
  stageFile: (input: GitFileStageInput) => Promise<GitFileStageResult>
  unstageFiles: (input: GitFileStageBatchInput) => Promise<GitFileStageBatchResult>
  unstageFile: (input: GitFileStageInput) => Promise<GitFileStageResult>
}
