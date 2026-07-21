import { promises as fs } from 'node:fs'
import path from 'node:path'
import ignore from 'ignore'
import { isWorkspaceExplorerTemporaryDeletingEntryName } from './explorerIgnore'

interface GitignoreMatcherEntry {
  basePath: string
  matcher: ignore.Ignore
}

export type WorkspaceEntryVisibility = 'explorer' | 'workspace'

const WORKSPACE_IGNORED_ENTRY_NAMES = new Set(['node_modules', '.next', '.echosphere', '.DS_Store', 'Thumbs.db'])
const EXPLORER_IGNORED_ENTRY_NAMES = new Set(['.git'])
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
  return entryName.toLowerCase().startsWith('.env')
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
