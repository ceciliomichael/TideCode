import { isWorkspaceExplorerTemporaryDeletingEntryName } from './explorerIgnore'

export const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  '__pycache__',
  '.cache',
  '.turbo',
  '.svelte-kit',
  '.angular',
  '.output',
  'venv',
  '.venv',
  '.tox',
])

export const IGNORED_FILE_NAMES: ReadonlySet<string> = new Set<string>()

/**
 * Mirrors chokidar's built-in atomic-write temp file filter (DOT_RE) so that
 * editor temp artifacts (vim swap files, backup files, Sublime temp files)
 * do not trigger explorer refreshes.
 */
const ATOMIC_WRITE_TEMP_FILE_PATTERN = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/iu

/**
 * Decides whether a workspace-relative path observed by the recursive explorer
 * watcher should be ignored. Any path segment matching an ignored directory
 * name (e.g. node_modules) suppresses the whole subtree, mirroring the
 * previous chokidar traversal behavior.
 */
export function shouldIgnoreWorkspaceWatchPath(relativePath: string) {
  const segments = relativePath.split(/[\\/]+/u).filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return false
  }

  const entryName = segments[segments.length - 1]
  return (
    ATOMIC_WRITE_TEMP_FILE_PATTERN.test(entryName) ||
    isWorkspaceExplorerTemporaryDeletingEntryName(entryName) ||
    IGNORED_FILE_NAMES.has(entryName) ||
    segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))
  )
}
