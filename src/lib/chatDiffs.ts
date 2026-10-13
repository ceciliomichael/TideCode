import { getDiffSummary } from './textDiff'
import type { FileDiffToolResultPresentation, GitFileDiff, Message } from '../types/chat'

export interface ConversationFileDiff {
  addedLineCount: number
  changeStatus?: 'added' | 'modified' | 'deleted' | 'renamed' | 'conflicted' | 'untracked'
  contentSignature: string
  contextLines?: number
  fileName: string
  indexContent?: string | null
  isStaged: boolean
  isUnstaged: boolean
  isUntracked: boolean
  isDeleted: boolean
  newContent: string
  oldContent: string | null
  originalFileName?: string
  stagedChangeStatus?: ConversationFileDiff['changeStatus']
  unstagedChangeStatus?: ConversationFileDiff['changeStatus']
  removedLineCount: number
  startLineNumber?: number
}

export interface ConversationDiffSnapshot {
  fileDiffs: ConversationFileDiff[]
  totalAddedLineCount: number
  totalRemovedLineCount: number
}

function hashString(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function buildDiffContentSignature(oldContent: string | null, newContent: string) {
  return [
    oldContent === null ? 'null' : `${oldContent.length}:${hashString(oldContent)}`,
    `${newContent.length}:${hashString(newContent)}`,
  ].join('|')
}

function normalizeFileDiff(result: FileDiffToolResultPresentation): ConversationFileDiff {
  const computedSummary = getDiffSummary(result.oldContent, result.newContent, {
    ...(result.startLineNumber === undefined ? {} : { startLineNumber: result.startLineNumber }),
  })

  return {
    addedLineCount: result.addedLineCount ?? computedSummary.addedLineCount,
    contentSignature: buildDiffContentSignature(result.oldContent, result.newContent),
    fileName: result.fileName,
    isStaged: false,
    isUnstaged: false,
    isUntracked: false,
    isDeleted: false,
    newContent: result.newContent,
    oldContent: result.oldContent,
    removedLineCount: result.removedLineCount ?? computedSummary.removedLineCount,
    ...(result.contextLines === undefined ? {} : { contextLines: result.contextLines }),
    ...(result.startLineNumber === undefined ? {} : { startLineNumber: result.startLineNumber }),
  }
}

function normalizeRawFileDiff(result: GitFileDiff): ConversationFileDiff {
  const computedSummary = getDiffSummary(result.oldContent, result.newContent)
  const isDeleted = result.isDeleted ?? false

  return {
    addedLineCount: result.addedLineCount ?? computedSummary.addedLineCount,
    contentSignature: buildDiffContentSignature(result.oldContent, result.newContent),
    fileName: result.fileName,
    ...(result.changeStatus ? { changeStatus: result.changeStatus } : {}),
    ...(result.originalFileName ? { originalFileName: result.originalFileName } : {}),
    ...(result.stagedChangeStatus ? { stagedChangeStatus: result.stagedChangeStatus } : {}),
    ...(result.unstagedChangeStatus ? { unstagedChangeStatus: result.unstagedChangeStatus } : {}),
    ...(result.indexContent !== undefined ? { indexContent: result.indexContent } : {}),
    isStaged: result.isStaged,
    isUnstaged: result.isUnstaged,
    isUntracked: result.isUntracked,
    isDeleted,
    newContent: result.newContent,
    oldContent: result.oldContent,
    removedLineCount: result.removedLineCount ?? computedSummary.removedLineCount,
  }
}

export function projectGitFileDiffScope(diff: ConversationFileDiff, scope: 'staged' | 'unstaged'): ConversationFileDiff {
  // Ordinary chat/branch diff snapshots have no index snapshot to project.
  if (diff.indexContent === undefined || diff.changeStatus === 'conflicted') return diff

  const oldContent = scope === 'staged' ? diff.oldContent : diff.indexContent
  const newContent = scope === 'staged' ? (diff.indexContent ?? '') : diff.newContent
  const summary = getDiffSummary(oldContent, newContent)
  const changeStatus = scope === 'staged' ? diff.stagedChangeStatus : diff.unstagedChangeStatus
  return {
    ...diff,
    changeStatus: changeStatus ?? diff.changeStatus,
    isDeleted: changeStatus === 'deleted',
    addedLineCount: summary.addedLineCount,
    contentSignature: buildDiffContentSignature(oldContent, newContent),
    newContent,
    oldContent,
    removedLineCount: summary.removedLineCount,
  }
}

export function buildFileDiffSnapshot(fileDiffs: readonly GitFileDiff[]): ConversationDiffSnapshot {
  const normalizedFileDiffs = fileDiffs
    .map((fileDiff) => normalizeRawFileDiff(fileDiff))
    .sort((left, right) => left.fileName.localeCompare(right.fileName, undefined, { sensitivity: 'base' }))

  let totalAddedLineCount = 0
  let totalRemovedLineCount = 0

  for (const diff of normalizedFileDiffs) {
    totalAddedLineCount += diff.addedLineCount
    totalRemovedLineCount += diff.removedLineCount
  }

  return {
    fileDiffs: normalizedFileDiffs,
    totalAddedLineCount,
    totalRemovedLineCount,
  }
}

export function buildConversationDiffSnapshot(messages: readonly Message[]): ConversationDiffSnapshot {
  const latestDiffByFile = new Map<string, ConversationFileDiff>()

  for (const message of messages) {
    if (!message.toolInvocations || message.toolInvocations.length === 0) {
      continue
    }

    for (const invocation of message.toolInvocations) {
      if (invocation.state !== 'completed' || invocation.resultPresentation?.kind !== 'file_diff') {
        continue
      }

      latestDiffByFile.set(invocation.resultPresentation.fileName, normalizeFileDiff(invocation.resultPresentation))
    }
  }

  return buildFileDiffSnapshot(Array.from(latestDiffByFile.values()))
}
