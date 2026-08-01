import path from 'node:path'
import type { GitHistoryEntry } from '../../src/types/chat'
import { extractCommitSubjectLine } from './commitMessageFormatting'

export interface GitHubRepositoryRef {
  owner: string
  repo: string
}

const CONVENTIONAL_COMMIT_SUBJECT_PATTERN = /^(feat|fix|docs|style|refactor|test|build|ci|perf|chore)(?:\([^)]+\))?!?:\s*(.+)$/iu
const DEFAULT_AUTONOMOUS_BRANCH_TYPE = 'chore'
export const AUTONOMOUS_BRANCH_MAX_LENGTH = 72
const AUTONOMOUS_BRANCH_SEGMENT_MAX_LENGTH = 52

export function splitNullDelimitedOutput(output: string) {
  return output
    .split('\0')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function normalizeGitFilePath(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

function parseDecoratedRefs(refText: string) {
  return refText
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

export function parseGitHistoryLine(line: string, headHash: string | null): GitHistoryEntry | null {
  const separatorIndex = line.indexOf('\u001f')
  if (separatorIndex < 0) {
    return null
  }

  const graphPrefix = line.slice(0, separatorIndex).replace(/\s+$/u, '')
  const payload = line.slice(separatorIndex + 1)
  const fields = payload.split('\u001f')
  if (fields.length < 8) {
    return null
  }

  const [hash, shortHash, parentIdsRaw, authorName, authoredAt, authoredRelativeTime, subject, refText] = fields
  const normalizedHash = hash.trim()
  if (normalizedHash.length === 0) {
    return null
  }

  const parentIds = parentIdsRaw
    .trim()
    .split(/\s+/)
    .filter((id) => id.length > 0)

  return {
    authorName: authorName.trim(),
    authoredAt: authoredAt.trim(),
    authoredRelativeTime: authoredRelativeTime.trim(),
    graphPrefix,
    hash: normalizedHash,
    isHead: headHash !== null && normalizedHash === headHash,
    parentIds,
    refs: parseDecoratedRefs(refText),
    shortHash: shortHash.trim(),
    subject: subject.trim(),
  }
}

export function remoteUrlToHttpsBase(remoteUrl: string): string | null {
  // SSH format: git@github.com:user/repo.git
  const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`
  }

  // HTTPS format: https://github.com/user/repo.git
  const httpsMatch = remoteUrl.match(/^https?:\/\/(.+?)(?:\.git)?$/)
  if (httpsMatch) {
    return `https://${httpsMatch[1]}`
  }

  return null
}

export function parseGitHubRepositoryRef(remoteUrl: string): GitHubRepositoryRef | null {
  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u.exec(remoteUrl)
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    }
  }

  const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/u.exec(remoteUrl)
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      repo: httpsMatch[2],
    }
  }

  const sshProtocolMatch = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/u.exec(remoteUrl)
  if (sshProtocolMatch) {
    return {
      owner: sshProtocolMatch[1],
      repo: sshProtocolMatch[2],
    }
  }

  return null
}

export function getCommitMessageSubject(commitMessage: string) {
  const firstLine = commitMessage
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  return firstLine ?? 'chore: update repository changes'
}

export function getCommitMessageBody(commitMessage: string) {
  const lines = commitMessage.split(/\r?\n/u)
  const firstNonEmptyLineIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstNonEmptyLineIndex < 0) {
    return 'Automated PR created by TideCode.'
  }

  const body = lines.slice(firstNonEmptyLineIndex + 1).join('\n').trim()

  return body.length > 0 ? body : 'Automated PR created by TideCode.'
}

export function extractGitHubPullRequestUrl(text: string) {
  const match = /(https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+)/u.exec(text)
  return match ? match[1] : null
}

export function trimInvalidBranchTail(value: string) {
  return value.replace(/[./-]+$/gu, '')
}

function sanitizeBranchSegment(value: string, maxLength = AUTONOMOUS_BRANCH_SEGMENT_MAX_LENGTH) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '')

  return trimInvalidBranchTail(normalized.slice(0, maxLength))
}

export function parseTouchedFilesFromNumstat(numstatText: string) {
  const touchedFiles = new Set<string>()

  for (const line of numstatText.split(/\r?\n/u)) {
    const trimmedLine = line.trim()
    if (trimmedLine.length === 0) {
      continue
    }

    const parts = trimmedLine.split(/\t/u)
    if (parts.length < 3) {
      continue
    }

    const rawPath = parts.slice(2).join('\t').trim()
    if (rawPath.length === 0) {
      continue
    }

    // Handle rename notations like `old/path.ts => new/path.ts`.
    const renamedTargetPath = rawPath.includes('=>') ? rawPath.split('=>').at(-1)?.trim() ?? rawPath : rawPath
    const normalizedPath = normalizeGitFilePath(renamedTargetPath.replace(/[{}]/gu, '').replace(/^"+|"+$/gu, ''))
    if (normalizedPath.length > 0) {
      touchedFiles.add(normalizedPath)
    }
  }

  return Array.from(touchedFiles)
}

function deriveBranchSummaryFromTouchedFiles(touchedFiles: readonly string[]) {
  if (touchedFiles.length === 0) {
    return 'update-changes'
  }

  const firstFile = touchedFiles[0]
  const firstFileBaseName = path.posix.basename(firstFile).replace(/\.[^.]+$/u, '')
  const normalizedFirstName = sanitizeBranchSegment(firstFileBaseName, 24)

  if (touchedFiles.length === 1) {
    return normalizedFirstName.length > 0 ? `update-${normalizedFirstName}` : 'update-file'
  }

  if (normalizedFirstName.length > 0) {
    return `update-${normalizedFirstName}-and-${touchedFiles.length - 1}-more`
  }

  return `update-${touchedFiles.length}-files`
}

export function buildAutonomousBranchBaseName(commitMessage: string, stagedNumstatText: string) {
  const commitSubject = extractCommitSubjectLine(commitMessage)
  const normalizedMessage = commitSubject.length > 0 ? commitSubject : commitMessage.trim()
  const conventionalMatch = CONVENTIONAL_COMMIT_SUBJECT_PATTERN.exec(normalizedMessage)
  const branchType = sanitizeBranchSegment(conventionalMatch?.[1] ?? DEFAULT_AUTONOMOUS_BRANCH_TYPE, 16)
  const summaryFromMessage = sanitizeBranchSegment(conventionalMatch?.[2] ?? normalizedMessage)
  const summary =
    summaryFromMessage.length > 0
      ? summaryFromMessage
      : deriveBranchSummaryFromTouchedFiles(parseTouchedFilesFromNumstat(stagedNumstatText))

  const normalizedType = branchType.length > 0 ? branchType : DEFAULT_AUTONOMOUS_BRANCH_TYPE
  const baseName = `${normalizedType}/${summary}`
  const boundedName = trimInvalidBranchTail(baseName.slice(0, AUTONOMOUS_BRANCH_MAX_LENGTH))

  return boundedName.length > 0 ? boundedName : `${DEFAULT_AUTONOMOUS_BRANCH_TYPE}/update-changes`
}

export function isDefaultBranchName(branchName: string, defaultBranch: string | null) {
  const normalizedBranchName = branchName.trim().toLowerCase()
  if (normalizedBranchName.length === 0) {
    return false
  }

  if (defaultBranch && normalizedBranchName === defaultBranch.trim().toLowerCase()) {
    return true
  }

  return normalizedBranchName === 'main' || normalizedBranchName === 'master'
}
