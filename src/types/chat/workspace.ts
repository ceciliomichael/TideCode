export interface CreateWorkspaceCheckpointInput {
  workspaceRootPath: string
}

export type WorkspaceDirectoryVisibility = 'explorer' | 'workspace'

export interface WorkspaceExplorerListDirectoryInput {
  recursive?: boolean
  relativePath?: string
  workspaceRootPath: string
  visibility?: WorkspaceDirectoryVisibility
}

export interface WorkspaceExplorerWatchChangesInput {
  relativeDirectoryPaths?: readonly string[]
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

export interface WorkspaceExplorerReadFileReadyResult {
  status: 'ready'
  content: string
  isBinary: boolean
  isTruncated: boolean
  modifiedTimeMs: number
  previewDataUrl?: string
  previewError?: string
  previewMimeType?: string
  relativePath: string
  sizeBytes: number
}

export interface WorkspaceExplorerReadFileMissingResult {
  relativePath: string
  status: 'missing'
}

export type WorkspaceExplorerReadFileResult =
  | WorkspaceExplorerReadFileMissingResult
  | WorkspaceExplorerReadFileReadyResult

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

export interface WorkspaceExplorerPasteClipboardImageInput {
  targetDirectoryRelativePath?: string
  workspaceRootPath: string
}

export interface WorkspaceExplorerPasteClipboardImageResult {
  relativePath: string
  sizeBytes: number
}

export interface CreateTerminalSessionInput {
  cols: number
  cwd?: string | null
  aiTurnId?: string | null
  isAiSession?: boolean
  label?: string | null
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
  venvName?: string | null
  workspaceRootPath: string | null
}

export interface WriteTerminalSessionInput {
  data: string
  sessionId: number
  workspaceRootPath?: string | null
}

export interface TerminalSessionOutputInput {
  pendingOutputLengthToConsume?: number
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
  tabKey?: string | null
  workspaceRootPath?: string | null
}

export interface TerminalTabClosedEvent {
  sessionId: number
  tabKey: string | null
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
