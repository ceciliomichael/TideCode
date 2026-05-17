import type { AppAppearance, AppLanguage, FollowUpBehavior } from '../lib/appSettings'
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanCreateCardRequest,
  KanbanDeleteCardRequest,
  KanbanMoveCardRequest,
  KanbanReadBoardRequest,
  KanbanReadCardRequest,
  KanbanUpdateCardInput,
  KanbanUpdateCardRequest,
  KanbanWorkspaceInput,
} from '../lib/kanban'

export type MessageRole = 'user' | 'assistant' | 'tool'
export type ChatMode = 'agent' | 'plan'
export type UserMessageKind = 'human' | 'tool_result'
export type ToolInvocationState = 'running' | 'completed' | 'failed'
export type AssistantWaitingIndicatorVariant = 'thinking' | 'splash' | 'rate_limit_retry'
export type ChatAttachmentKind = 'image' | 'text'
export type ToolDecisionKind = 'ready_implement' | 'ask_question'

export interface ToolDecisionOption {
  id: string
  label: string
}

export interface ToolDecisionRequest {
  allowCustomAnswer: boolean
  kind: ToolDecisionKind
  options: ToolDecisionOption[]
  prompt: string
  streamId: string
}

export interface FileDiffToolResultPresentation {
  addedLineCount?: number
  contextLines?: number
  endLineNumber?: number
  fileName: string
  kind: 'file_diff'
  newContent: string
  oldContent: string | null
  removedLineCount?: number
  startLineNumber?: number
}

export interface ChangeDiffToolResultItem {
  addedLineCount?: number
  contextLines?: number
  endLineNumber?: number
  fileName: string
  kind: 'add' | 'delete' | 'update'
  newContent: string
  oldContent: string | null
  removedLineCount?: number
  startLineNumber?: number
}

export interface ChangeDiffToolResultPresentation {
  changes: ChangeDiffToolResultItem[]
  kind: 'change_diff'
}

export type ToolInvocationResultPresentation = FileDiffToolResultPresentation | ChangeDiffToolResultPresentation

interface ChatAttachmentBase {
  fileName: string
  id: string
  kind: ChatAttachmentKind
  mimeType: string
  sizeBytes: number
}

export interface ChatImageAttachment extends ChatAttachmentBase {
  dataUrl: string
  kind: 'image'
}

export interface ChatTextAttachment extends ChatAttachmentBase {
  kind: 'text'
  textContent: string
}

export type ChatAttachment = ChatImageAttachment | ChatTextAttachment

export interface QueuedMessage {
  attachments?: ChatAttachment[]
  content: string
  id: string
  timestamp: number
}

export interface ToolInvocationTrace {
  argumentsText: string
  completedAt?: number
  decisionRequest?: ToolDecisionRequest
  id: string
  resultContent?: string
  resultPresentation?: ToolInvocationResultPresentation
  startedAt: number
  state: ToolInvocationState
  toolName: string
}

export interface Message {
  attachments?: ChatAttachment[]
  id: string
  role: MessageRole
  content: string
  modelId?: string
  providerId?: ChatProviderId
  reasoningContent?: string
  reasoningCompletedAt?: number
  reasoningEffort?: ReasoningEffort
  runCheckpoint?: UserMessageRunCheckpoint
  timestamp: number
  toolCallId?: string
  toolInvocations?: ToolInvocationTrace[]
  userMessageKind?: UserMessageKind
}

export interface UserMessageRunCheckpoint {
  createdAt: number
  id: string
}

export interface ConversationSummary {
  agentContextRootPath: string
  chatMode: ChatMode
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
  folderId: string | null
}

export interface ConversationPreview {
  id: string
  title: string
  preview: string
  updatedAtLabel: string
  folderId: string | null
  isActive?: boolean
  hasRunningTask?: boolean
}

export interface ConversationRecord {
  agentContextRootPath: string
  chatMode: ChatMode
  id: string
  title: string
  createdAt: number
  updatedAt: number
  folderId: string | null
  messages: Message[]
}

export interface ConversationFolderRecord {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface ConversationFolderSummary {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

export interface ConversationFolderPreview {
  id: string | null
  name: string
  path: string | null
  conversationCount: number
  isSelected?: boolean
}

export interface ConversationGroupPreview {
  folder: ConversationFolderPreview
  conversations: ConversationPreview[]
}

export interface CreateConversationInput {
  chatMode?: ChatMode
  folderId?: string | null
}

export interface CreateConversationFolderInput {
  name: string
  path: string
}

export interface RenameConversationFolderInput {
  folderId: string
  name: string
}

export type FolderMoveDirection = 'up' | 'down'

export type FolderReorderPosition = 'before' | 'after'

export interface ReorderConversationFolderInput {
  folderId: string
  targetFolderId: string
  position: FolderReorderPosition
}

export interface AppendConversationMessagesInput {
  chatMode?: ChatMode
  conversationId: string
  messages: Message[]
  title?: string
}

export interface ReplaceConversationMessagesInput {
  chatMode?: ChatMode
  conversationId: string
  messages: Message[]
  title?: string
}

export interface AppSettings {
  appearance: AppAppearance
  chatModelId: string
  chatModelProviderId: ChatProviderId | null
  chatModelLabel: string
  chatReasoningEffort: ReasoningEffort
  agentModelId: string
  agentModelProviderId: ChatProviderId | null
  agentModelLabel: string
  planModelId: string
  planModelProviderId: ChatProviderId | null
  planModelLabel: string
  summarizationModelId: string
  summarizationModelProviderId: ChatProviderId | null
  summarizationModelLabel: string
  gitCommitModelId: string
  gitCommitModelProviderId: ChatProviderId | null
  gitCommitModelLabel: string
  diffPanelWidth: number
  editSessionsByConversation: Record<string, ConversationEditSession>
  followUpBehavior: FollowUpBehavior
  language: AppLanguage
  lastActiveConversationId: string | null
  lastActiveDraftFolderId: string | null
  openEmptyConversationOnLaunch: boolean
  revertEditSessionsByConversation: Record<string, RevertEditSession>
  sendMessageOnEnter: boolean
  workspaceFileEditorWordWrap: boolean
  disabledSkillsByPath: Record<string, boolean>
  sidebarWidth: number

  workspaceEditorWidth: number
  workspaceExplorerWidth: number
  sourceControlSectionOrder: SourceControlSectionId[]
  sourceControlSectionOpen: Record<SourceControlSectionOpenId, boolean>
  sourceControlSectionSizes: Record<SourceControlSectionId, number>
  terminalOpenByWorkspace: Record<string, boolean>
  terminalPanelHeightsByWorkspace: Record<string, number>
  terminalExecutionMode: AppTerminalExecutionMode
}

export type SourceControlSectionId = 'commit' | 'changes' | 'history'
export type SourceControlSectionOpenId = SourceControlSectionId | 'staged' | 'unstaged'
export type AppTerminalExecutionMode = 'full' | 'sandbox'

export interface ConversationEditSession {
  messageId: string
}

export interface RevertEditSession {
  messageId: string
  redoCheckpointId: string
}

export interface CodexProviderConnectionStatus {
  accountId: string | null
  accountKey: string | null
  authFilePath: string
  email: string | null
  accounts: CodexAccountSummary[]
  isAuthenticated: boolean
  lastRefreshAt: string | null
  tokenExpiresAt: string | null
}

export interface CodexUsageWindow {
  usedPercent: number
  limitWindowSeconds: number
  resetAfterSeconds: number
  resetAt: number
}

export interface CodexUsageSnapshot {
  fetchedAt: string
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
}

export interface CodexAccountSummary {
  accountId: string
  accountKey: string
  email: string | null
  isActive: boolean
  label: string
  lastRefreshAt: string | null
  tokenExpiresAt: string | null
  usage: CodexUsageSnapshot | null
}

export type ApiKeyProviderId = 'anthropic' | 'google' | 'mistral' | 'openai' | 'openai-compatible'
export type ChatProviderId = 'codex' | ApiKeyProviderId
export type CustomModelProviderId = 'openai' | 'openai-compatible'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ApiKeyProviderStatus {
  apiKey: string | null
  baseUrl: string | null
  configured: boolean
  hasApiKey: boolean
  id: ApiKeyProviderId
  label: string
}

export interface ProvidersState {
  apiKeyProviders: ApiKeyProviderStatus[]
  codex: CodexProviderConnectionStatus
}

export interface SaveApiKeyProviderInput {
  apiKey: string
  baseUrl?: string
  providerId: ApiKeyProviderId
}

export interface CustomModelConfig {
  apiModelId: string
  createdAt: string
  id: string
  label: string
  providerId: CustomModelProviderId
  reasoningCapable: boolean
  updatedAt: string
}

export interface SaveCustomModelInput {
  apiModelId: string
  label?: string
  providerId: CustomModelProviderId
  reasoningCapable: boolean
}

export interface StartChatStreamInput {
  agentContextRootPath: string
  chatMode: ChatMode
  conversationId?: string
  messages: Message[]
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  terminalExecutionMode: AppTerminalExecutionMode
}

export interface CompressChatHistoryInput {
  agentContextRootPath: string
  chatMode: ChatMode
  messages: Message[]
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

export interface StartChatStreamResult {
  streamId: string
}

export interface ProviderModelConfig {
  apiModelId: string
  enabledByDefault: boolean
  id: string
  label: string
  providerId: ChatProviderId
  reasoningCapable: boolean
}

export interface SubmitToolDecisionInput {
  customAnswer?: string
  invocationId: string
  selectedOptionId?: string
  streamId: string
}

export interface SubmitToolDecisionResult {
  accepted: boolean
}

export interface EstimateContextUsageInput {
  agentContextRootPath: string | null
  chatMode: ChatMode
  messages: Message[]
  providerId: ChatProviderId
}

export interface CreateWorkspaceCheckpointInput {
  workspaceRootPath: string
}

export type WorkspaceDirectoryVisibility = 'explorer' | 'workspace'

export interface WorkspaceExplorerListDirectoryInput {
  relativePath?: string
  workspaceRootPath: string
  visibility?: WorkspaceDirectoryVisibility
}

export interface WorkspaceExplorerWatchChangesInput {
  workspaceRootPath: string
}

export interface WorkspaceExplorerChangeEvent {
  workspaceRootPath: string
}

export interface WorkspaceExplorerEntry {
  isDirectory: boolean
  isGitignored?: boolean
  name: string
  relativePath: string
}

export interface WorkspaceExplorerReadFileInput {
  relativePath: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerReadFileResult {
  content: string
  isBinary: boolean
  isTruncated: boolean
  relativePath: string
  sizeBytes: number
}

export interface WorkspaceRefactorCandidatesInput {
  workspaceRootPath: string
}

export interface WorkspaceRefactorCandidate {
  lineCount: number
  relativePath: string
}

export interface WorkspaceExplorerWriteFileInput {
  content: string
  relativePath: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerWriteFileResult {
  relativePath: string
  sizeBytes: number
}

export interface WorkspaceExplorerCreateEntryInput {
  isDirectory: boolean
  relativePath: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerCreateEntryResult {
  isDirectory: boolean
  relativePath: string
}

export interface WorkspaceExplorerRenameEntryInput {
  nextRelativePath: string
  relativePath: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerRenameEntryResult {
  nextRelativePath: string
  relativePath: string
}

export interface WorkspaceExplorerDeleteEntryInput {
  relativePath: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerDeleteEntryResult {
  relativePath: string
}

export type WorkspaceExplorerTransferMode = 'copy' | 'move'

export interface WorkspaceExplorerTransferEntryInput {
  mode: WorkspaceExplorerTransferMode
  relativePath: string
  targetDirectoryRelativePath?: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerTransferEntryResult {
  mode: WorkspaceExplorerTransferMode
  relativePath: string
  targetRelativePath: string
}

export interface WorkspaceExplorerImportEntryInput {
  sourcePath: string
  targetDirectoryRelativePath?: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerImportEntryResult {
  relativePath: string
  sourcePath: string
  targetRelativePath: string
}

export interface CreateTerminalSessionInput {
  cols: number
  cwd?: string | null
  sessionKey?: string | null
  workspaceRootPath?: string | null
  rows: number
}

export interface CreateTerminalSessionResult {
  bufferedOutput: string
  cwd: string
  isReused: boolean
  sessionId: number
  shell: string
  workspaceRootPath: string | null
}

export interface WriteTerminalSessionInput {
  data: string
  sessionId: number
  workspaceRootPath?: string | null
}

export interface TerminalSessionOutputInput {
  pollingMs?: number
  sessionId: number
  workspaceRootPath?: string | null
}

export interface ResizeTerminalSessionInput {
  cols: number
  rows: number
  sessionId: number
  workspaceRootPath?: string | null
}

export interface CloseTerminalSessionInput {
  sessionId: number
  workspaceRootPath?: string | null
}

export interface OpenExternalTerminalLinkInput {
  url: string
}

export interface TerminalDataEvent {
  data: string
  sessionId: number
}

export interface TerminalExitEvent {
  exitCode: number
  sessionId: number
  signal: number | null
}

export interface ContextUsageEstimate {
  historyTokens: number
  maxTokens: number
  systemPromptTokens: number
  toolResultsTokens: number
  totalTokens: number
}

export interface GitBranchState {
  branches: string[]
  currentBranch: string | null
  defaultBranch: string | null
  hasRepository: boolean
  isDetachedHead: boolean
  repoRootPath: string | null
}

export interface CheckoutGitBranchInput {
  branchName: string
  workspacePath: string
}

export interface CreateGitBranchInput {
  branchName: string
  workspacePath: string
}

export interface GitFileDiff {
  addedLineCount?: number
  fileName: string
  isDeleted?: boolean
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  newContent: string
  oldContent: string | null
  removedLineCount?: number
}

export interface GitDiffSnapshot {
  fileDiffs: GitFileDiff[]
  hasRepository: boolean
}

export type GitCommitAction = 'commit' | 'commit-and-push' | 'commit-and-create-pr'

export interface GitCommitInput {
  action: GitCommitAction
  includeUnstaged: boolean
  modelId?: string
  message: string
  preferredBranchName?: string
  providerId?: ChatProviderId
  reasoningEffort?: ReasoningEffort
  workspacePath: string
}

export interface GitCommitResult {
  branchName: string | null
  commitHash: string
  defaultBranchName: string | null
  historyEntry?: GitHistoryEntry | null
  message: string
  postCommitWarning: string | null
  prUrl: string | null
  pulledLatestOnDefaultBranch: boolean
  success: boolean
  switchedToDefaultBranch: boolean
}

export interface GitStatusResult {
  addedLineCount: number
  changedFileCount: number
  hasRepository: boolean
  removedLineCount: number
  stagedFileCount: number
  unstagedFileCount: number
  untrackedFileCount: number
}

export interface GitFileStageInput {
  filePath: string
  workspacePath: string
}

export interface GitFileStageResult {
  filePath: string
  success: boolean
}

export interface GitFileStageBatchInput {
  filePaths: string[]
  workspacePath: string
}

export interface GitFileStageBatchResult {
  filePaths: string[]
  success: boolean
}

export type GitSyncAction = 'fetch-all' | 'pull' | 'push'

export interface GitSyncInput {
  action: GitSyncAction
  workspacePath: string
}

export interface GitSyncResult {
  action: GitSyncAction
  branchName: string | null
  message: string
  success: boolean
}

export interface GitHistoryPageInput {
  limit: number
  offset: number
  workspacePath: string
}

export interface GitHistoryEntry {
  authorName: string
  authoredAt: string
  authoredRelativeTime: string
  graphPrefix: string
  hash: string
  isHead: boolean
  parentIds: string[]
  refs: string[]
  shortHash: string
  subject: string
}

export interface GitHistoryPageResult {
  entries: GitHistoryEntry[]
  hasMore: boolean
  hasRepository: boolean
  headHash: string | null
}

export interface GitHistoryCommitDetailsInput {
  commitHash: string
  workspacePath: string
}

export interface GitHistoryCommitFile {
  path: string
  status: string
}

export interface GitHistoryCommitDetailsResult {
  changedFileCount: number
  commitHash: string
  deletions: number
  files: GitHistoryCommitFile[]
  hasRepository: boolean
  insertions: number
  messageBody: string
}

export type ChatStreamEvent =
  | {
      streamId: string
      type: 'started'
    }
  | {
      delta: string
      streamId: string
      type: 'content_delta'
    }
  | {
      delta: string
      streamId: string
      type: 'reasoning_delta'
    }
  | {
      streamId: string
      type: 'reasoning_completed'
    }
  | {
      allowCustomAnswer: boolean
      invocationId: string
      kind: ToolDecisionKind
      options: ToolDecisionOption[]
      prompt: string
      streamId: string
      toolName: string
      type: 'tool_invocation_decision_requested'
    }
  | {
      argumentsText: string
      invocationId: string
      startedAt: number
      streamId: string
      toolName: string
      type: 'tool_invocation_started'
    }
  | {
      argumentsText: string
      invocationId: string
      streamId: string
      toolName: string
      type: 'tool_invocation_delta'
    }
  | {
      argumentsText: string
      completedAt: number
      invocationId: string
      resultContent: string
      resultPresentation?: ToolInvocationResultPresentation
      streamId: string
      syntheticMessage: Message
      toolName: string
      type: 'tool_invocation_completed'
    }
  | {
      argumentsText: string
      completedAt: number
      errorMessage: string
      invocationId: string
      resultContent: string
      resultPresentation?: ToolInvocationResultPresentation
      streamId: string
      syntheticMessage: Message
      toolName: string
      type: 'tool_invocation_failed'
    }
  | {
      streamId: string
      type: 'completed'
    }
  | {
      streamId: string
      type: 'aborted'
    }
  | {
      errorMessage: string
      streamId: string
      type: 'error'
    }

export interface EchosphereHistoryApi {
  listConversations: () => Promise<ConversationSummary[]>
  listFolders: () => Promise<ConversationFolderSummary[]>
  getConversation: (conversationId: string) => Promise<ConversationRecord | null>
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
}

export interface EchosphereSettingsApi {
  getInitialSettings: () => AppSettings
  getSettings: () => Promise<AppSettings>
  updateSettings: (input: Partial<AppSettings>) => Promise<AppSettings>
}

export interface EchosphereProvidersApi {
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

export interface EchosphereModelsApi {
  listCustomModels: () => Promise<CustomModelConfig[]>
  listProviderModels: (providerId: ChatProviderId) => Promise<ProviderModelConfig[]>
  removeCustomModel: (modelId: string) => Promise<CustomModelConfig[]>
  saveCustomModel: (input: SaveCustomModelInput) => Promise<CustomModelConfig[]>
}

export interface EchosphereChatApi {
  cancelStream: (streamId: string) => Promise<void>
  compressConversation: (input: CompressChatHistoryInput) => Promise<string>
  estimateContextUsage: (input: EstimateContextUsageInput) => Promise<ContextUsageEstimate>
  onStreamEvent: (listener: (event: ChatStreamEvent) => void) => () => void
  submitToolDecision: (input: SubmitToolDecisionInput) => Promise<SubmitToolDecisionResult>
  startStream: (input: StartChatStreamInput) => Promise<StartChatStreamResult>
}

export interface EchosphereKanbanApi {
  clearCompletedCards: (input: KanbanWorkspaceInput) => Promise<KanbanBoardData>
  createCard: (input: KanbanCreateCardRequest) => Promise<KanbanCard>
  deleteCard: (input: KanbanDeleteCardRequest) => Promise<KanbanBoardData>
  getBoardData: (input: KanbanWorkspaceInput) => Promise<KanbanBoardData>
  importBoardData: (input: KanbanWorkspaceInput & KanbanBoardData) => Promise<KanbanBoardData>
  moveCard: (input: KanbanMoveCardRequest) => Promise<KanbanCard>
  readBoard: (input: KanbanReadBoardRequest) => Promise<import('../lib/kanban').KanbanColumnReadResult>
  readCard: (input: KanbanReadCardRequest) => Promise<KanbanCard | null>
  updateCard: (input: KanbanWorkspaceInput & KanbanUpdateCardInput) => Promise<KanbanCard>
  updateCardContent: (input: KanbanUpdateCardRequest) => Promise<KanbanCard>
}

export interface EchosphereWorkspaceApi {
  createCheckpoint: (input: CreateWorkspaceCheckpointInput) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSource: (sourceCheckpointId: string) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSources: (sourceCheckpointIds: string[]) => Promise<UserMessageRunCheckpoint>
  createEntry: (input: WorkspaceExplorerCreateEntryInput) => Promise<WorkspaceExplorerCreateEntryResult>
  deleteEntry: (input: WorkspaceExplorerDeleteEntryInput) => Promise<WorkspaceExplorerDeleteEntryResult>
  importEntry: (input: WorkspaceExplorerImportEntryInput) => Promise<WorkspaceExplorerImportEntryResult>
  listRefactorCandidates: (input: WorkspaceRefactorCandidatesInput) => Promise<WorkspaceRefactorCandidate[]>
  onExplorerChange: (listener: (event: WorkspaceExplorerChangeEvent) => void) => () => void
  listDirectory: (input: WorkspaceExplorerListDirectoryInput) => Promise<WorkspaceExplorerEntry[]>
  readFile: (input: WorkspaceExplorerReadFileInput) => Promise<WorkspaceExplorerReadFileResult>
  renameEntry: (input: WorkspaceExplorerRenameEntryInput) => Promise<WorkspaceExplorerRenameEntryResult>
  unwatchExplorerChanges: (input: WorkspaceExplorerWatchChangesInput) => Promise<void>
  transferEntry: (input: WorkspaceExplorerTransferEntryInput) => Promise<WorkspaceExplorerTransferEntryResult>
  watchExplorerChanges: (input: WorkspaceExplorerWatchChangesInput) => Promise<void>
  writeFile: (input: WorkspaceExplorerWriteFileInput) => Promise<WorkspaceExplorerWriteFileResult>
  restoreCheckpoint: (checkpointId: string) => Promise<void>
  restoreCheckpointSequence: (checkpointIds: string[]) => Promise<void>
}

export interface EchosphereTerminalApi {
  closeSession: (input: CloseTerminalSessionInput) => Promise<void>
  createSession: (input: CreateTerminalSessionInput) => Promise<CreateTerminalSessionResult>
  openExternalLink: (input: OpenExternalTerminalLinkInput) => Promise<void>
  onData: (listener: (event: TerminalDataEvent) => void) => () => void
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void
  resizeSession: (input: ResizeTerminalSessionInput) => Promise<void>
  writeToSession: (input: WriteTerminalSessionInput) => Promise<void>
}

export interface EchosphereGitApi {
  checkoutBranch: (input: CheckoutGitBranchInput) => Promise<GitBranchState>
  commit: (input: GitCommitInput) => Promise<GitCommitResult>
  createAndCheckoutBranch: (input: CreateGitBranchInput) => Promise<GitBranchState>
  discardFileChanges: (input: GitFileStageInput) => Promise<GitFileStageResult>
  getBranches: (workspacePath: string) => Promise<GitBranchState>
  getHistoryCommitDetails: (input: GitHistoryCommitDetailsInput) => Promise<GitHistoryCommitDetailsResult>
  getDiffs: (workspacePath: string) => Promise<GitDiffSnapshot>
  getHistoryPage: (input: GitHistoryPageInput) => Promise<GitHistoryPageResult>
  getStatus: (workspacePath: string) => Promise<GitStatusResult>
  sync: (input: GitSyncInput) => Promise<GitSyncResult>
  stageFiles: (input: GitFileStageBatchInput) => Promise<GitFileStageBatchResult>
  stageFile: (input: GitFileStageInput) => Promise<GitFileStageResult>
  unstageFiles: (input: GitFileStageBatchInput) => Promise<GitFileStageBatchResult>
  unstageFile: (input: GitFileStageInput) => Promise<GitFileStageResult>
}
