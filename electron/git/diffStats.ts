import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { getErrorMessage, runGit } from './repositoryContext'
import type { GitDiffLineCounts } from '../../src/types/chat'

interface GitFileStats extends GitDiffLineCounts {
  stagedLineCounts: GitDiffLineCounts
  unstagedLineCounts: GitDiffLineCounts
}

const lineCountCache = new Map<string, { modified: number; size: number; lines: number }>()

export function parseGitNumstat(output: string) {
  const fields = output.split('\0')
  const stats = new Map<string, GitDiffLineCounts>()
  for (let index = 0; index < fields.length; index += 1) {
    if (!fields[index]) {
      continue
    }
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/u.exec(fields[index])
    if (!match) {
      throw new Error('Git returned invalid line statistics.')
    }
    let fileName = match[3]
    if (!fileName) {
      // -z emits a rename as an empty name, then original and current paths.
      index += 2
      fileName = fields[index]
    }
    stats.set(fileName, {
      addedLineCount: match[1] === '-' ? 0 : Number(match[1]),
      removedLineCount: match[2] === '-' ? 0 : Number(match[2]),
    })
  }
  return stats
}

async function countUntrackedLines(filePath: string) {
  try {
    const info = await lstat(filePath)
    if (!info.isFile()) {
      return 0
    }
    const cached = lineCountCache.get(filePath)
    if (cached?.modified === info.mtimeMs && cached.size === info.size) {
      return cached.lines
    }
    let lines = 0
    let lastByte = -1
    for await (const chunk of createReadStream(filePath)) {
      const buffer = chunk as Buffer
      if (buffer.includes(0)) {
        lines = 0
        lastByte = -1
        break
      }
      for (const byte of buffer) {
        if (byte === 10) {
          lines += 1
        }
      }
      lastByte = buffer.at(-1) ?? lastByte
    }
    if (lastByte !== -1 && lastByte !== 10) {
      lines += 1
    }
    lineCountCache.delete(filePath)
    lineCountCache.set(filePath, { modified: info.mtimeMs, size: info.size, lines })
    while (lineCountCache.size > 128) {
      lineCountCache.delete(lineCountCache.keys().next().value!)
    }
    return lines
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return 0
    }
    throw error
  }
}

async function readNumstat(repoRootPath: string, revisions: string[]) {
  const { stdout } = await runGit(
    ['diff', '--numstat', '-z', '--find-renames', ...revisions, '--', '.'],
    repoRootPath,
    { timeoutMs: 30_000 },
  )
  return parseGitNumstat(stdout)
}

function statsForStatusPath(
  stats: Map<string, GitDiffLineCounts>,
  file: { fileName: string; originalFileName?: string },
  changedNames: Set<string>,
): GitDiffLineCounts {
  const current = stats.get(file.fileName)
  if (file.originalFileName && !changedNames.has(file.originalFileName)) {
    const original = stats.get(file.originalFileName)
    if (original) {
      // Git can split a heavily edited rename into a deletion and addition.
      // Its original-path deletion still belongs to the renamed status row.
      return {
        addedLineCount: original.addedLineCount + (current?.addedLineCount ?? 0),
        removedLineCount: original.removedLineCount + (current?.removedLineCount ?? 0),
      }
    }
  }
  return current ?? { addedLineCount: 0, removedLineCount: 0 }
}

export async function readGitDiffStats(
  repoRootPath: string,
  changedFiles: readonly { fileName: string; isStaged: boolean; isUnstaged: boolean; isUntracked: boolean; originalFileName?: string; changeStatus?: string }[],
) {
  const hasStagedChanges = changedFiles.some(file => file.isStaged)
  const [combined, staged, unstaged] = await Promise.all([
    readNumstat(repoRootPath, ['HEAD']).catch(error => {
      const message = getErrorMessage(error)
      if (!/unknown revision|bad revision|ambiguous argument 'HEAD'/iu.test(message)) {
        throw error
      }
      // Without HEAD, combined counts describe all current working-tree lines.
      return null
    }),
    hasStagedChanges
      ? readNumstat(repoRootPath, ['--cached'])
      : new Map<string, GitDiffLineCounts>(),
    hasStagedChanges && changedFiles.some(file => file.isUnstaged)
      ? readNumstat(repoRootPath, [])
      : new Map<string, GitDiffLineCounts>(),
  ])
  const changedNames = new Set(changedFiles.map(file => file.fileName))
  const stats = new Map<string, GitFileStats>()
  for (const file of changedFiles) {
    let combinedCounts: GitDiffLineCounts
    if (!combined || file.isUntracked) {
      // Untracked files are absent from Git numstat. Stream and cache counts
      // without retaining their source strings; binary files contribute zero.
      combinedCounts = {
        addedLineCount: await countUntrackedLines(path.join(repoRootPath, file.fileName)),
        removedLineCount: 0,
      }
    } else {
      combinedCounts = statsForStatusPath(combined, file, changedNames)
    }
    // With no staged changes, index and HEAD match for ordinary files.
    // Reuse the combined statistics instead of running a duplicate diff.
    let unstagedCounts = combinedCounts
    if (hasStagedChanges) {
      unstagedCounts = statsForStatusPath(unstaged, file, changedNames)
    }
    if (file.isUntracked || file.changeStatus === 'conflicted') {
      // Conflict previews use HEAD-to-worktree, not an unavailable index blob.
      unstagedCounts = combinedCounts
    }
    stats.set(file.fileName, {
      ...combinedCounts,
      stagedLineCounts: statsForStatusPath(staged, file, changedNames),
      unstagedLineCounts: unstagedCounts,
    })
  }
  return stats
}
