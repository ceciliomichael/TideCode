import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  isGitignored,
  loadGitignoreMatchers,
  shouldAlwaysShowEntry,
  shouldIgnoreWorkspaceEntry,
} from '../../../workspace/gitignoreMatcher'

const RIPGREP_ALL_FILES_GLOBS = new Set(['**/*', '**/{*,.*}', '**'])
type GitignoreMatchers = Awaited<ReturnType<typeof loadGitignoreMatchers>>

export async function listImmediateDirectoryEntries(
  workspaceRootPath: string,
  directoryPath: string,
  options?: { relaxIgnore?: boolean },
): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  const filteredEntries = entries
    .filter((entry) => !entry.isSymbolicLink())
    .filter((entry) => entry.isDirectory() || entry.isFile())

  if (options?.relaxIgnore) {
    return filteredEntries
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
  }

  const gitignoreMatchers = await loadGitignoreMatchers(workspaceRootPath, directoryPath)
  return filteredEntries
    .filter((entry) => !shouldIgnoreWorkspaceEntry(entry.name))
    .filter((entry) => {
      if (shouldAlwaysShowEntry(entry.name)) {
        return true
      }

      return !isGitignored(path.join(directoryPath, entry.name), entry.isDirectory(), gitignoreMatchers)
    })
    .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
}

export function createWorkspaceEntryVisibilityFilter(
  workspaceRootPath: string,
  options?: { ignoreBasePath?: string },
) {
  const matcherCache = new Map<string, Promise<GitignoreMatchers>>()
  const ignoreBaseSegments =
    options?.ignoreBasePath
      ? path
          .relative(workspaceRootPath, options.ignoreBasePath)
          .split(path.sep)
          .filter((segment) => segment.length > 0)
          .filter((segment) => segment !== '.' && !segment.startsWith('..'))
      : []

  function loadCachedMatchers(directoryPath: string): Promise<GitignoreMatchers> {
    const normalizedDirectoryPath = path.resolve(directoryPath)
    let matchersPromise: Promise<GitignoreMatchers> | undefined = matcherCache.get(normalizedDirectoryPath)
    if (!matchersPromise) {
      matchersPromise = loadGitignoreMatchers(workspaceRootPath, normalizedDirectoryPath)
      matcherCache.set(normalizedDirectoryPath, matchersPromise)
    }

    return matchersPromise
  }

  function isUnderIgnoreBase(entrySegments: readonly string[]) {
    if (ignoreBaseSegments.length === 0) {
      return false
    }

    if (entrySegments.length < ignoreBaseSegments.length) {
      return false
    }

    for (let index = 0; index < ignoreBaseSegments.length; index += 1) {
      if (entrySegments[index] !== ignoreBaseSegments[index]) {
        return false
      }
    }

    return true
  }

  return async (entryAbsolutePath: string, isDirectory: boolean) => {
    const workspaceRelativeSegments = path
      .relative(workspaceRootPath, entryAbsolutePath)
      .split(path.sep)
      .filter((segment) => segment.length > 0)

    const underIgnoreBase = isUnderIgnoreBase(workspaceRelativeSegments)

    if (!underIgnoreBase) {
      if (workspaceRelativeSegments.some((segment) => shouldIgnoreWorkspaceEntry(segment))) {
        return false
      }
    }

    const gitignoreMatchers = await loadCachedMatchers(path.dirname(entryAbsolutePath))
    if (underIgnoreBase) {
      return true
    }

    return !isGitignored(entryAbsolutePath, isDirectory, gitignoreMatchers)
  }
}

export function normalizeSearchIncludePattern(include: string | undefined) {
  const trimmedInclude = include?.trim()
  if (!trimmedInclude) {
    return null
  }

  if (RIPGREP_ALL_FILES_GLOBS.has(trimmedInclude)) {
    return null
  }

  return trimmedInclude
}

export async function filterVisibleRelativeFileEntries(
  workspaceRootPath: string,
  baseAbsolutePath: string,
  relativeEntries: readonly string[],
  options?: { ignoreBasePath?: string },
) {
  const isVisibleEntry = createWorkspaceEntryVisibilityFilter(workspaceRootPath, {
    ignoreBasePath: options?.ignoreBasePath,
  })
  const visibleEntries: string[] = []

  for (const relativeEntry of relativeEntries) {
    const entryAbsolutePath = path.resolve(baseAbsolutePath, relativeEntry)
    if (await isVisibleEntry(entryAbsolutePath, false)) {
      visibleEntries.push(relativeEntry)
    }
  }

  return visibleEntries
}
