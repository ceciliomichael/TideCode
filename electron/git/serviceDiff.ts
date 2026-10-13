import type { GitDiffLoadOptions, GitDiffSnapshot, GitFileDiff } from '../../src/types/chat'
import { readHeadFile, readIndexFile, readWorkingTreeFile, resolveRepositoryRoot, runGit } from './repositoryContext'
import { normalizeGitFilePath } from './serviceHelpers'

type ChangeStatus = NonNullable<GitFileDiff['changeStatus']>
interface ChangedFileStatus {
  fileName: string
  changeStatus: ChangeStatus
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  isDeleted: boolean
  stagedChangeStatus?: ChangeStatus
  unstagedChangeStatus?: ChangeStatus
  originalFileName?: string
}

const MAX_CONCURRENT_FILE_READS = 24
const BACKGROUND_GIT_TIMEOUT_MS = 30_000
const BACKGROUND_GIT_OPTIONS = { timeoutMs: BACKGROUND_GIT_TIMEOUT_MS }

function classifyGitChangeCode(code: string): ChangeStatus {
  if (code === 'R' || code === 'C') return 'renamed'
  if (code === 'D') return 'deleted'
  if (code === 'A') return 'added'
  return 'modified'
}

async function mapWithConcurrency<T, R>(items: readonly T[], worker: (item: T) => Promise<R>, limit: number) {
  const results: R[] = []
  let nextIndex = 0

  async function consume() {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex
      nextIndex += 1
      results[itemIndex] = await worker(items[itemIndex])
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: workerCount }, () => consume()))
  return results
}

export function parseGitPorcelainStatus(output: string): ChangedFileStatus[] {
  const fields = output.split('\0')
  const changedFiles: ChangedFileStatus[] = []
  const unmergedCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

  for (let index = 0; index < fields.length; index++) {
    const record = fields[index]
    if (!record || record.length < 4 || record[2] !== ' ') continue

    const code = record.slice(0, 2)
    const indexCode = code[0]
    const worktreeCode = code[1]
    const fileName = normalizeGitFilePath(record.slice(3))
    const isUntracked = code === '??'
    const isConflicted = unmergedCodes.has(code)
    const isRenamed = indexCode === 'R' || worktreeCode === 'R' || indexCode === 'C' || worktreeCode === 'C'
    const originalFileName = isRenamed ? normalizeGitFilePath(fields[++index] ?? '') : undefined
    const isDeleted = indexCode === 'D' || worktreeCode === 'D'
    const stagedChangeStatus = !isConflicted && !isUntracked && indexCode !== ' '
      ? classifyGitChangeCode(indexCode) : undefined
    const unstagedChangeStatus = isConflicted ? 'conflicted'
      : isUntracked ? 'untracked'
        : worktreeCode !== ' ' ? classifyGitChangeCode(worktreeCode) : undefined
    const changeStatus: ChangeStatus = isConflicted ? 'conflicted'
      : isUntracked ? 'untracked'
        : isRenamed ? 'renamed'
          : isDeleted ? 'deleted'
            : indexCode === 'A' || worktreeCode === 'A' ? 'added' : 'modified'

    changedFiles.push({
      fileName,
      changeStatus,
      isStaged: !isConflicted && !isUntracked && indexCode !== ' ',
      isUnstaged: isConflicted || (!isUntracked && worktreeCode !== ' '),
      isUntracked,
      isDeleted,
      ...(stagedChangeStatus ? { stagedChangeStatus } : {}),
      ...(unstagedChangeStatus ? { unstagedChangeStatus } : {}),
      ...(originalFileName ? { originalFileName } : {}),
    })
  }

  return changedFiles
}

async function readChangedFiles(repoRootPath: string): Promise<ChangedFileStatus[]> {
  // One porcelain snapshot keeps rename and merge codes coherent with file lists.
  // Errors must propagate: empty output must mean clean, not an unreadable index.
  const { stdout } = await runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'],
    repoRootPath,
    BACKGROUND_GIT_OPTIONS,
  )
  return parseGitPorcelainStatus(stdout)
}

async function buildGitFileDiff(
  repoRootPath: string,
  status: ChangedFileStatus,
): Promise<GitFileDiff> {
  const [oldContent, indexContent, newContent] = await Promise.all([
    readHeadFile(repoRootPath, status.originalFileName ?? status.fileName, BACKGROUND_GIT_OPTIONS),
    readIndexFile(repoRootPath, status.fileName, BACKGROUND_GIT_OPTIONS),
    readWorkingTreeFile(repoRootPath, status.fileName),
  ])
  return {
    ...status,
    indexContent,
    newContent: newContent ?? '',
    oldContent,
    ...(newContent === null ? { addedLineCount: 0, removedLineCount: 0 } : {}),
  }
}

export async function getGitDiffSnapshot(
  workspacePath: string,
  options?: GitDiffLoadOptions,
): Promise<GitDiffSnapshot> {
  const repoRootPath = await resolveRepositoryRoot(workspacePath, BACKGROUND_GIT_OPTIONS)
  if (!repoRootPath) {
    return {
      fileDiffs: [],
      hasRepository: false,
    }
  }

  const changedFiles = await readChangedFiles(repoRootPath)
  const fileDiffs = options?.includeContent === false
    ? changedFiles.map((status): GitFileDiff => {
        return {
          ...status,
          addedLineCount: 0,
          indexContent: null,
          newContent: '',
          oldContent: null,
          removedLineCount: 0,
        }
      })
    : (
        await mapWithConcurrency(
          changedFiles,
          (status) => buildGitFileDiff(repoRootPath, status),
          MAX_CONCURRENT_FILE_READS,
        )
      )

  return {
    fileDiffs,
    hasRepository: true,
  }
}

