import path from 'node:path'
import { isWorkspaceExplorerTemporaryDeletingEntryName } from '../workspace/explorerIgnore'
import { IGNORED_DIRECTORY_NAMES } from '../workspace/explorerWatchFilter'

const ATOMIC_WRITE_TEMP_FILE_PATTERN = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/iu
const IGNORED_WORKTREE_DIRECTORY_NAMES = new Set(
  Array.from(IGNORED_DIRECTORY_NAMES).filter((directoryName) => directoryName !== '.git'),
)

export function shouldIgnoreGitSourceControlWatchPath(workspacePath: string, candidatePath: string) {
  const relativePath = path.relative(workspacePath, candidatePath)
  if (relativePath.length === 0) {
    return false
  }

  if (relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    return true
  }

  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return false
  }

  const entryName = segments[segments.length - 1] ?? ''
  return (
    ATOMIC_WRITE_TEMP_FILE_PATTERN.test(entryName) ||
    isWorkspaceExplorerTemporaryDeletingEntryName(entryName) ||
    segments.some((segment) => IGNORED_WORKTREE_DIRECTORY_NAMES.has(segment))
  )
}
