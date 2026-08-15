import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { shouldIgnoreWorkspaceWatchPath } from './explorerWatchFilter'

const DEFAULT_RELATIVE_PATH = '.'

export interface WorkspaceDirectoryWatcher {
  readonly ready: Promise<void>
  close(): Promise<void>
}

interface CreateWorkspaceDirectoryWatcherInput {
  onChange: () => void
  onError: (error: unknown) => void
  rootPath: string
  watchedRelativeDirectoryPaths: ReadonlySet<string>
}

export function resolveWorkspaceDirectoryWatchTargets(
  rootPath: string,
  watchedRelativeDirectoryPaths: ReadonlySet<string>,
) {
  const normalizedRootPath = path.resolve(rootPath)
  const watchTargets = new Set<string>()

  for (const relativePath of watchedRelativeDirectoryPaths) {
    const absolutePath = relativePath === DEFAULT_RELATIVE_PATH
      ? normalizedRootPath
      : path.resolve(normalizedRootPath, relativePath)
    const normalizedRelativePath = path.relative(normalizedRootPath, absolutePath)

    if (normalizedRelativePath.startsWith('..') || path.isAbsolute(normalizedRelativePath)) {
      continue
    }

    watchTargets.add(absolutePath)
  }

  if (watchTargets.size === 0) {
    watchTargets.add(normalizedRootPath)
  }

  return Array.from(watchTargets)
}

export function createWorkspaceDirectoryWatcher({
  onChange,
  onError,
  rootPath,
  watchedRelativeDirectoryPaths,
}: CreateWorkspaceDirectoryWatcherInput): WorkspaceDirectoryWatcher {
  const normalizedRootPath = path.resolve(rootPath)
  const watchTargets = resolveWorkspaceDirectoryWatchTargets(
    normalizedRootPath,
    watchedRelativeDirectoryPaths,
  )
  const watcher: FSWatcher = chokidar.watch(watchTargets, {
    depth: 0,
    ignoreInitial: true,
    ignored: (candidatePath: string) => {
      const relativePath = path.relative(normalizedRootPath, candidatePath)
      return relativePath.length > 0 && shouldIgnoreWorkspaceWatchPath(relativePath)
    },
  })
  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', resolve)
    watcher.once('error', () => resolve())
  })

  watcher.on('all', onChange)
  watcher.on('error', onError)

  return {
    ready,
    close: () => watcher.close(),
  }
}
