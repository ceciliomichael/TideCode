import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { minimatch } from 'minimatch'
import {
  isExplicitlyGitignoredPath,
  isGitignored,
  isInsideWorkspaceIgnoredPath,
  loadGitignoreMatchers,
  shouldIgnoreWorkspaceEntry,
} from '../../../workspace/gitignoreMatcher'

const ALL_FILES_GLOBS = new Set(['**/*', '**/{*,.*}', '**'])

interface SearchMatch {
  absolutePath: string
  lineNumber: number
  lineText: string
  relativePath: string
}

interface SearchVisibleFilesResult {
  matches: SearchMatch[]
  invalidPattern: boolean
  truncated: boolean
}

interface RipgrepFallbackResult {
  exitCode: number
  stderr: string
  stdout: string
}

function hasBinaryContent(buffer: Buffer) {
  const probeLength = Math.min(buffer.length, 1024)
  for (let index = 0; index < probeLength; index += 1) {
    if (buffer[index] === 0) {
      return true
    }
  }

  return false
}

function matchesWorkspaceGlob(candidatePath: string, globPattern: string) {
  const normalizedCandidatePath = candidatePath.split(path.sep).join('/')
  const normalizedPattern = globPattern.split(path.sep).join('/')
  return minimatch(normalizedCandidatePath, normalizedPattern, { dot: true })
}

function normalizeSearchIncludePattern(includePattern: string | null) {
  const trimmedIncludePattern = includePattern?.trim()
  if (!trimmedIncludePattern) {
    return null
  }

  if (ALL_FILES_GLOBS.has(trimmedIncludePattern)) {
    return null
  }

  return trimmedIncludePattern
}

function createWorkspaceEntryVisibilityFilter(
  workspaceRootPath: string,
  options?: {
    ignoreBasePath?: string
    ignoreWorkspaceRules?: boolean
  },
) {
  const matcherCache = new Map<string, Promise<Awaited<ReturnType<typeof loadGitignoreMatchers>>>>()
  const ignoreBaseSegments =
    options?.ignoreBasePath
      ? path
          .relative(workspaceRootPath, options.ignoreBasePath)
          .split(path.sep)
          .filter((segment) => segment.length > 0)
          .filter((segment) => segment !== '.' && !segment.startsWith('..'))
      : []

  function loadCachedMatchers(directoryPath: string): Promise<Awaited<ReturnType<typeof loadGitignoreMatchers>>> {
    const normalizedDirectoryPath = path.resolve(directoryPath)
    let matchersPromise: Promise<Awaited<ReturnType<typeof loadGitignoreMatchers>>> | undefined =
      matcherCache.get(normalizedDirectoryPath)
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

    if (underIgnoreBase) {
      return true
    }

    if (workspaceRelativeSegments.some((segment) => shouldIgnoreWorkspaceEntry(segment, 'explorer'))) {
      return false
    }

    if (!options?.ignoreWorkspaceRules) {
      if (workspaceRelativeSegments.some((segment) => shouldIgnoreWorkspaceEntry(segment))) {
        return false
      }
    }

    const gitignoreMatchers = await loadCachedMatchers(path.dirname(entryAbsolutePath))
    return !isGitignored(entryAbsolutePath, isDirectory, gitignoreMatchers)
  }
}

async function visitVisibleFiles(
  workspaceRootPath: string,
  currentDirectoryPath: string,
  isVisibleEntry: (entryAbsolutePath: string, isDirectory: boolean) => Promise<boolean>,
  onFile: (fileAbsolutePath: string, fileRelativePath: string) => Promise<boolean | void> | boolean | void,
) {
  const directoryEntries = await fs.readdir(currentDirectoryPath, { withFileTypes: true })
  directoryEntries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))

  for (const directoryEntry of directoryEntries) {
    if (directoryEntry.isSymbolicLink()) {
      continue
    }

    const isDirectory = directoryEntry.isDirectory()
    if (!isDirectory && !directoryEntry.isFile()) {
      continue
    }

    const entryAbsolutePath = path.join(currentDirectoryPath, directoryEntry.name)
    if (!(await isVisibleEntry(entryAbsolutePath, isDirectory))) {
      continue
    }

    if (isDirectory) {
      const shouldStop = await visitVisibleFiles(workspaceRootPath, entryAbsolutePath, isVisibleEntry, onFile)
      if (shouldStop) {
        return true
      }
      continue
    }

    const fileRelativePath = path.relative(workspaceRootPath, entryAbsolutePath)
    const shouldStop = await onFile(entryAbsolutePath, fileRelativePath)
    if (shouldStop) {
      return true
    }
  }

  return false
}

async function collectVisibleFilePaths(workspaceRootPath: string) {
  const filePaths: string[] = []
  const isVisibleEntry = createWorkspaceEntryVisibilityFilter(workspaceRootPath)
  await visitVisibleFiles(workspaceRootPath, workspaceRootPath, isVisibleEntry, async (_, fileRelativePath) => {
    filePaths.push(fileRelativePath)
  })
  return filePaths
}

function toJsonMatchLine(relativePath: string, lineNumber: number, lineText: string) {
  return JSON.stringify({
    data: {
      line_number: lineNumber,
      lines: {
        text: lineText,
      },
      path: {
        text: relativePath,
      },
    },
    type: 'match',
  })
}

export async function searchVisibleFiles(
  workspaceRootPath: string,
  searchRootPath: string,
  pattern: string,
  include: string | undefined,
  maxResults?: number,
  options?: {
    ignoreBasePath?: string
    ignoreWorkspaceRules?: boolean
    literalFallback?: boolean
    regex?: boolean
  },
): Promise<SearchVisibleFilesResult> {
  const includePattern = include?.trim()
  let searchExpression: RegExp | null = null
  let invalidPattern = false
  if (options?.regex !== false) {
    try {
      searchExpression = new RegExp(pattern, 'u')
    } catch {
      searchExpression = null
      invalidPattern = true
    }
  }
  const matches: SearchMatch[] = []
  const isVisibleEntry = createWorkspaceEntryVisibilityFilter(workspaceRootPath, {
    ignoreBasePath: options?.ignoreBasePath,
    ignoreWorkspaceRules: options?.ignoreWorkspaceRules,
  })
  let truncated = false
  const includeMatchPattern = includePattern ?? null

  async function searchFile(fileAbsolutePath: string, fileRelativePath: string) {
    if (includeMatchPattern && !matchesWorkspaceGlob(fileRelativePath, includeMatchPattern)) {
      return false
    }

    const fileStats = await fs.stat(fileAbsolutePath).catch(() => null)
    if (!fileStats?.isFile()) {
      return false
    }

    const probe = Buffer.alloc(Math.min(fileStats.size, 1024))
    if (probe.length > 0) {
      const fileHandle = await fs.open(fileAbsolutePath, 'r')
      try {
        await fileHandle.read(probe, 0, probe.length, 0)
      } finally {
        await fileHandle.close()
      }
    }

    if (hasBinaryContent(probe)) {
      return false
    }

    const stream = createReadStream(fileAbsolutePath, { encoding: 'utf8' })
    const reader = createInterface({
      crlfDelay: Infinity,
      input: stream,
    })

    let lineNumber = 0
    try {
      for await (const line of reader) {
        lineNumber += 1
        const hasMatch = searchExpression
          ? searchExpression.test(line)
          : options?.literalFallback === false
            ? false
            : line.includes(pattern)
        if (!hasMatch) {
          continue
        }

        matches.push({
          absolutePath: fileAbsolutePath,
          lineNumber,
          lineText: line.trimEnd(),
          relativePath: fileRelativePath,
        })

        if (typeof maxResults === 'number' && Number.isFinite(maxResults) && matches.length >= maxResults) {
          truncated = true
          return true
        }
      }
    } finally {
      reader.close()
      stream.destroy()
    }

    return false
  }

  const searchRootStats = await fs.stat(searchRootPath).catch(() => null)
  if (!searchRootStats) {
    return {
      matches,
      invalidPattern,
      truncated,
    }
  }

  if (searchRootStats.isFile()) {
    const isVisibleFile = await isVisibleEntry(searchRootPath, false)
    if (isVisibleFile) {
      const fileRelativePath = path.relative(workspaceRootPath, searchRootPath)
      await searchFile(searchRootPath, fileRelativePath)
    }

    return {
      matches,
      invalidPattern,
      truncated,
    }
  }

  await visitVisibleFiles(workspaceRootPath, searchRootPath, isVisibleEntry, async (fileAbsolutePath, fileRelativePath) => {
    return searchFile(fileAbsolutePath, fileRelativePath)
  })

  matches.sort((left, right) => {
    if (left.absolutePath !== right.absolutePath) {
      return left.absolutePath.localeCompare(right.absolutePath, undefined, { sensitivity: 'base' })
    }

    return left.lineNumber - right.lineNumber
  })

  return {
    matches,
    invalidPattern,
    truncated,
  }
}

function getArgumentValues(args: string[], flagName: string) {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flagName || index + 1 >= args.length) {
      continue
    }

    values.push(args[index + 1])
  }

  return values
}

function getFirstArgumentValue(args: string[], flagName: string) {
  return getArgumentValues(args, flagName)[0] ?? null
}

function getPrimaryGlobPattern(args: string[]) {
  const globPatterns = getArgumentValues(args, '--glob')
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)

  return globPatterns.find((pattern) => !pattern.startsWith('!')) ?? null
}

function getExcludedGlobPatterns(args: string[]) {
  return new Set(
    getArgumentValues(args, '--glob')
      .map((pattern) => pattern.trim())
      .filter((pattern) => pattern.startsWith('!')),
  )
}

function getSearchPatternArg(args: string[]) {
  if (args.length < 2) {
    return null
  }

  return args[args.length - 2] ?? null
}

function getSearchPathArg(args: string[]) {
  if (args.length === 0) {
    return null
  }

  return args[args.length - 1] ?? null
}

export async function runRipgrepFallback(args: string[], cwd: string): Promise<RipgrepFallbackResult> {
  if (args.includes('--files')) {
    const files = await collectVisibleFilePaths(cwd)
    const globPattern = getPrimaryGlobPattern(args)
    const excludedGlobPatterns = getExcludedGlobPatterns(args)
    const normalizedGlobPattern = normalizeSearchIncludePattern(globPattern)
    const filteredFiles =
      normalizedGlobPattern && normalizedGlobPattern.length > 0
        ? files.filter((filePath) => matchesWorkspaceGlob(filePath, normalizedGlobPattern))
        : files
    const visibleFiles = filteredFiles.filter(
      (filePath) => ![...excludedGlobPatterns].some((globPattern) => matchesWorkspaceGlob(filePath, globPattern.slice(1))),
    )

    return {
      exitCode: 0,
      stderr: '',
      stdout: visibleFiles.join('\n'),
    }
  }

  if (args.includes('--regexp')) {
    const searchPattern = getFirstArgumentValue(args, '--regexp')
    const searchPath = getSearchPathArg(args)
    if (searchPattern === null || searchPath === null) {
      return {
        exitCode: 2,
        stderr: 'Invalid search pattern.',
        stdout: '',
      }
    }

    const searchPathStats = await fs.stat(searchPath).catch(() => null)
    if (!searchPathStats || (!searchPathStats.isDirectory() && !searchPathStats.isFile())) {
      return {
        exitCode: 2,
        stderr: 'Search path must be a file or directory.',
        stdout: '',
      }
    }

    const include = normalizeSearchIncludePattern(getPrimaryGlobPattern(args)) ?? undefined
    const ignoreBasePath =
      searchPathStats.isDirectory() &&
      (isInsideWorkspaceIgnoredPath(cwd, searchPath) ||
        (await isExplicitlyGitignoredPath(cwd, searchPath, true)))
        ? searchPath
        : undefined
    const result = await searchVisibleFiles(cwd, searchPath, searchPattern, include, undefined, {
      ignoreBasePath,
      ignoreWorkspaceRules: false,
      literalFallback: false,
      regex: true,
    })
    if (result.invalidPattern) {
      return {
        exitCode: 2,
        stderr: 'Invalid search pattern.',
        stdout: '',
      }
    }

    if (result.matches.length === 0) {
      return {
        exitCode: 1,
        stderr: '',
        stdout: '',
      }
    }

    return {
      exitCode: 0,
      stderr: result.truncated ? 'Some matches were truncated.' : '',
      stdout: result.matches.map((match) => `${match.absolutePath}|${match.lineNumber}|${match.lineText}`).join('\n'),
    }
  }

  if (args.includes('--json') && args.includes('--line-number')) {
    const searchPattern = getSearchPatternArg(args)
    if (searchPattern === null || searchPattern === '.') {
      return {
        exitCode: 2,
        stderr: 'Invalid search pattern.',
        stdout: '',
      }
    }

    const include = normalizeSearchIncludePattern(getPrimaryGlobPattern(args)) ?? undefined
    const result = await searchVisibleFiles(cwd, cwd, searchPattern, include)
    if (result.matches.length === 0) {
      return {
        exitCode: 1,
        stderr: '',
        stdout: '',
      }
    }

    return {
      exitCode: 0,
      stderr: '',
      stdout: result.matches.map((match) => toJsonMatchLine(match.relativePath, match.lineNumber, match.lineText)).join('\n'),
    }
  }

  throw new Error('Unsupported ripgrep fallback invocation.')
}
