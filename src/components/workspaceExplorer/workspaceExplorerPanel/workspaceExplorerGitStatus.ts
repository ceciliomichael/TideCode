import type { GitFileDiff } from '../../../types/chat'
import { ROOT_DIRECTORY_KEY, getAncestorDirectoryPaths, normalizeEntryPath, toDirectoryKey } from './workspaceExplorerPanelUtils'

export type ExplorerGitDisplayStatus = 'modified' | 'untracked'

const STATUS_PRIORITY: Record<ExplorerGitDisplayStatus, number> = {
  modified: 2,
  untracked: 1,
}

function getFileDisplayStatus(diff: GitFileDiff): ExplorerGitDisplayStatus | null {
  if (diff.isUntracked) {
    return 'untracked'
  }

  if (diff.isDeleted || diff.isStaged || diff.isUnstaged) {
    return 'modified'
  }

  return null
}

function mergeStatus(
  statusByPath: Map<string, ExplorerGitDisplayStatus>,
  path: string,
  nextStatus: ExplorerGitDisplayStatus,
) {
  const existing = statusByPath.get(path)
  if (!existing || STATUS_PRIORITY[nextStatus] > STATUS_PRIORITY[existing]) {
    statusByPath.set(path, nextStatus)
  }
}

export function buildExplorerGitStatusMap(gitFileDiffs: readonly GitFileDiff[]) {
  const statusByPath = new Map<string, ExplorerGitDisplayStatus>()

  for (const diff of gitFileDiffs) {
    const status = getFileDisplayStatus(diff)
    if (!status) {
      continue
    }

    const filePath = toDirectoryKey(normalizeEntryPath(diff.fileName))
    mergeStatus(statusByPath, filePath, status)
    mergeStatus(statusByPath, ROOT_DIRECTORY_KEY, status)

    for (const ancestorPath of getAncestorDirectoryPaths(filePath)) {
      mergeStatus(statusByPath, ancestorPath, status)
    }
  }

  return statusByPath
}
