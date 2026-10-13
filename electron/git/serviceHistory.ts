import type {
  GitHistoryCommitDetailsInput,
  GitHistoryCommitDetailsResult,
  GitHistoryEntry,
  GitHistoryPageInput,
  GitHistoryPageResult,
  GitStatusResult,
} from '../../src/types/chat'
import {
  getErrorMessage,
  isGitUnavailable,
  readHeadCommitHash,
  resolveRepositoryRoot,
  runGit,
} from './repositoryContext'
import { normalizeGitFilePath, parseGitHistoryLine, splitNullDelimitedOutput } from './serviceHelpers'

export async function getGitStatus(workspacePath: string): Promise<GitStatusResult> {
  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    return {
      addedLineCount: 0,
      changedFileCount: 0,
      hasRepository: false,
      removedLineCount: 0,
      stagedFileCount: 0,
      unstagedFileCount: 0,
      untrackedFileCount: 0,
    }
  }

  const [stagedResult, unstagedResult, untrackedResult] = await Promise.all([
    runGit(['diff', '--cached', '--name-only', '-z', '--', '.'], repoRootPath),
    runGit(['diff', '--name-only', '-z', '--', '.'], repoRootPath),
    runGit(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], repoRootPath),
  ])

  const stagedFiles = splitNullDelimitedOutput(stagedResult.stdout)
  const unstagedFiles = splitNullDelimitedOutput(unstagedResult.stdout)
  const untrackedFiles = splitNullDelimitedOutput(untrackedResult.stdout)
  const allChangedFiles = new Set([...stagedFiles, ...unstagedFiles, ...untrackedFiles])

  let addedLineCount = 0
  let removedLineCount = 0

  try {
    const [stagedNumstat, unstagedNumstat] = await Promise.all([
      runGit(['diff', '--cached', '--numstat', '--', '.'], repoRootPath).catch(() => ({ stdout: '' })),
      runGit(['diff', '--numstat', '--', '.'], repoRootPath).catch(() => ({ stdout: '' })),
    ])

    const processedFiles = new Set<string>()

    for (const numstatOutput of [stagedNumstat.stdout, unstagedNumstat.stdout]) {
      for (const line of numstatOutput.split(/\r?\n/)) {
        const trimmedLine = line.trim()
        if (trimmedLine.length === 0) {
          continue
        }

        const parts = trimmedLine.split(/\t/)
        if (parts.length < 3) {
          continue
        }

        const fileName = parts[2]
        if (processedFiles.has(fileName)) {
          continue
        }

        processedFiles.add(fileName)
        const added = parseInt(parts[0], 10)
        const removed = parseInt(parts[1], 10)

        if (!isNaN(added)) {
          addedLineCount += added
        }

        if (!isNaN(removed)) {
          removedLineCount += removed
        }
      }
    }
  } catch {
    // numstat calculation is best-effort
  }

  return {
    addedLineCount,
    changedFileCount: allChangedFiles.size,
    hasRepository: true,
    removedLineCount,
    stagedFileCount: stagedFiles.length,
    unstagedFileCount: unstagedFiles.length,
    untrackedFileCount: untrackedFiles.length,
  }
}

export async function getGitHistoryPage(input: GitHistoryPageInput): Promise<GitHistoryPageResult> {
  const workspacePath = input.workspacePath.trim()
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.round(input.limit))) : 200
  const offset = Number.isFinite(input.offset) ? Math.max(0, Math.round(input.offset)) : 0

  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    return {
      entries: [],
      hasMore: false,
      hasRepository: false,
      headHash: null,
    }
  }

  const headHash = await readHeadCommitHash(repoRootPath)
  const maxEntriesToRead = limit + 1
  const logFormat = '%x1f%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%ar%x1f%s%x1f%D'

  let historyStdout = ''
  try {
    const { stdout } = await runGit(
      [
        'log',
        '--graph',
        '--decorate=short',
        '--date=iso-strict',
        '--pretty=format:' + logFormat,
        '--all',
        '--no-color',
        `--skip=${offset}`,
        `-n${maxEntriesToRead}`,
      ],
      repoRootPath,
    )
    historyStdout = stdout
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase()
    if (message.includes('does not have any commits yet')) {
      return {
        entries: [],
        hasMore: false,
        hasRepository: true,
        headHash,
      }
    }

    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to load git history: ${getErrorMessage(error)}`)
  }

  const parsedEntries = historyStdout
    .split(/\r?\n/u)
    .map((line) => parseGitHistoryLine(line, headHash))
    .filter((entry): entry is GitHistoryEntry => entry !== null)

  return {
    entries: parsedEntries.slice(0, limit),
    hasMore: parsedEntries.length > limit,
    hasRepository: true,
    headHash,
  }
}

export async function getGitHistoryCommitDetails(
  input: GitHistoryCommitDetailsInput,
): Promise<GitHistoryCommitDetailsResult> {
  const workspacePath = input.workspacePath.trim()
  const commitHash = input.commitHash.trim()

  if (workspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  if (commitHash.length === 0) {
    throw new Error('Commit hash is required.')
  }

  const repoRootPath = await resolveRepositoryRoot(workspacePath)
  if (!repoRootPath) {
    return {
      changedFileCount: 0,
      commitHash,
      deletions: 0,
      files: [],
      hasRepository: false,
      insertions: 0,
      messageBody: '',
    }
  }

  try {
    const [{ stdout: filesStdout }, { stdout: bodyStdout }, { stdout: shortStatStdout }] = await Promise.all([
      runGit(
        ['show', '--format=', '--name-status', '--find-renames', '--no-color', '-m', '--first-parent', commitHash],
        repoRootPath,
      ),
      runGit(['log', '-1', '--format=%B', '--no-color', commitHash], repoRootPath),
      runGit(['show', '--format=', '--shortstat', '--no-color', '-m', '--first-parent', commitHash], repoRootPath),
    ])

    const files = filesStdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [status = 'M', ...pathParts] = line.split(/\t+/u)
        const rawPath = pathParts.at(-1) ?? ''
        return {
          path: normalizeGitFilePath(rawPath.trim()),
          status: status.trim().length > 0 ? status.trim() : 'M',
        }
      })
      .filter((file) => file.path.length > 0)

    const shortStatLine = shortStatStdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0)

    const filesChangedMatch = /(\d+)\s+files?\s+changed/iu.exec(shortStatLine ?? '')
    const insertionsMatch = /(\d+)\s+insertions?\(\+\)/iu.exec(shortStatLine ?? '')
    const deletionsMatch = /(\d+)\s+deletions?\(-\)/iu.exec(shortStatLine ?? '')
    const changedFileCount = filesChangedMatch ? Number.parseInt(filesChangedMatch[1], 10) : files.length
    const insertions = insertionsMatch ? Number.parseInt(insertionsMatch[1], 10) : 0
    const deletions = deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0

    return {
      changedFileCount,
      commitHash,
      deletions,
      files,
      hasRepository: true,
      insertions,
      messageBody: bodyStdout.trim(),
    }
  } catch (error) {
    if (isGitUnavailable(error)) {
      throw new Error('Git is not available in the current environment.')
    }

    throw new Error(`Failed to load commit details: ${getErrorMessage(error)}`)
  }
}

