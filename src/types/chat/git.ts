import type { ChatProviderId, ReasoningEffort } from './providers'

export interface GitBranchState {
  aheadCommitCount: number
  behindCommitCount: number
  branches: string[]
  currentBranch: string | null
  defaultBranch: string | null
  hasRepository: boolean
  hasUpstream: boolean
  isDetachedHead: boolean
  remoteUrl: string | null
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

export interface GitDiffLoadOptions {
  includeContent?: boolean
}

export type GitCommitAction = 'commit' | 'commit-and-push' | 'commit-and-create-pr'

export interface GitCommitInput {
  action: GitCommitAction
  includeUnstaged?: boolean
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

export interface GitSourceControlWatchChangesInput {
  workspacePath: string
}

export interface GitSourceControlChangeEvent {
  workspacePath: string
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

export type GitSyncAction = 'fetch-all' | 'pull' | 'push' | 'sync'

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

export interface GitInitResult {
  repoRootPath: string
  success: boolean
}

export type GitHubAuthStatus =
  | {
      kind: 'authenticated'
    }
  | {
      kind: 'not-authenticated'
      message: string
    }
  | {
      kind: 'unavailable'
      message: string
    }

export interface GitHubDeviceLoginResult {
  expiresAt: string
  userCode: string
  verificationUri: string
}

export interface GitPublishInput {
  workspacePath: string
  repoName: string
  description?: string
  isPrivate: boolean
  defaultBranch: string
}

export interface GitPublishResult {
  remoteUrl: string
  repoUrl: string
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
