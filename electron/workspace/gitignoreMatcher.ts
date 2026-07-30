import { promises as fs } from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'
import { isWorkspaceExplorerTemporaryDeletingEntryName } from './explorerIgnore'

interface GitignoreMatcherEntry {
  basePath: string
  matcher: ignore.Ignore
}

export type WorkspaceEntryVisibility = 'explorer' | 'workspace'

export const WORKSPACE_IGNORED_ENTRY_NAMES: ReadonlySet<string> = new Set<string>([
  '.echosphere',
  '.git',
  '.next',
  'node_modules',
])
const EXPLORER_IGNORED_ENTRY_NAMES = new Set<string>(['.git'])
const gitignoreMatcherCache = new Map<string, Promise<GitignoreMatcherEntry[]>>()

function toPosixRelativePath(fromPath: string, toPath: string) {
  return path.relative(fromPath, toPath).split(path.sep).join('/')
}

async function loadGitignoreMatcher(basePath: string): Promise<GitignoreMatcherEntry | null> {
  const gitignorePath = path.join(basePath, '.gitignore')

  try {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8')
    if (gitignoreContent.trim().length === 0) {
      return null
    }

    return {
      basePath,
      matcher: ignore().add(gitignoreContent),
    } satisfies GitignoreMatcherEntry
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

export async function loadGitignoreMatchers(
  rootPath: string,
  directoryPath: string,
): Promise<GitignoreMatcherEntry[]> {
  const normalizedRootPath = path.resolve(rootPath)
  const normalizedDirectoryPath = path.resolve(directoryPath)
  const cacheKey = `${normalizedRootPath}\0${normalizedDirectoryPath}`

  let matchersPromise: Promise<GitignoreMatcherEntry[]> | undefined = gitignoreMatcherCache.get(cacheKey)
  if (!matchersPromise) {
    matchersPromise = (async () => {
      const relativePath = path.relative(normalizedRootPath, normalizedDirectoryPath)
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return []
      }

      const parentPath = normalizedDirectoryPath === normalizedRootPath ? null : path.dirname(normalizedDirectoryPath)
      const parentMatchers: GitignoreMatcherEntry[] = parentPath
        ? await loadGitignoreMatchers(normalizedRootPath, parentPath)
        : []
      const localMatcher = await loadGitignoreMatcher(normalizedDirectoryPath)

      return localMatcher ? [...parentMatchers, localMatcher] : parentMatchers
    })()

    gitignoreMatcherCache.set(cacheKey, matchersPromise)
  }

  return matchersPromise
}

export function isGitignored(
  targetPath: string,
  isDirectory: boolean,
  matcherEntries: readonly GitignoreMatcherEntry[],
) {
  let isIgnored = false

  for (const matcherEntry of matcherEntries) {
    const relativePath = toPosixRelativePath(matcherEntry.basePath, targetPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath.length === 0) {
      continue
    }

    const candidatePath = isDirectory ? `${relativePath}/` : relativePath
    const result = matcherEntry.matcher.checkIgnore(candidatePath)
    if (result.ignored) {
      isIgnored = true
      continue
    }

    if (result.unignored) {
      isIgnored = false
    }
  }

  return isIgnored
}

export function shouldAlwaysShowEntry(entryName: string) {
  const normalized = entryName.toLowerCase()
  return normalized.startsWith('.env') || normalized.startsWith('agents.md')
}

/**
 * Returns true when any path segment of the relative path from workspaceRootPath
 * to absolutePath matches a workspace-ignored entry name (e.g. "node_modules").
 *
 * This is used to determine whether the AI explicitly targeted a directory inside
 * an otherwise ignored tree so that tools can relax filtering for that subtree.
 */
export function isInsideWorkspaceIgnoredPath(workspaceRootPath: string, absolutePath: string) {
  const relativeSegments = path
    .relative(path.resolve(workspaceRootPath), path.resolve(absolutePath))
    .split(path.sep)
    .filter((segment) => segment.length > 0)

  if (relativeSegments.length > 0 && (relativeSegments[0] === '..' || path.isAbsolute(relativeSegments[0]))) {
    return false
  }

  return relativeSegments.some((segment) => WORKSPACE_IGNORED_ENTRY_NAMES.has(segment))
}

export function shouldIgnoreWorkspaceEntry(entryName: string, visibility: WorkspaceEntryVisibility = 'workspace') {
  if (isWorkspaceExplorerTemporaryDeletingEntryName(entryName)) {
    return true
  }

  if (EXPLORER_IGNORED_ENTRY_NAMES.has(entryName)) {
    return true
  }

  if (visibility === 'explorer') {
    return false
  }

  return WORKSPACE_IGNORED_ENTRY_NAMES.has(entryName)
}
