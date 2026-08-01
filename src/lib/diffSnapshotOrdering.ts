import type { ConversationDiffSnapshot, ConversationFileDiff } from './chatDiffs'

/**
 * Keeps the visual order of files that are already on screen and appends new
 * files at the end of the list. The incoming diff data still owns each row's
 * contents and status, so existing rows update in place without being reset.
 */
export function appendNewDiffsToSnapshot(
  previousSnapshot: ConversationDiffSnapshot,
  incomingSnapshot: ConversationDiffSnapshot,
): ConversationDiffSnapshot {
  const incomingDiffByPath = new Map<string, ConversationFileDiff>(
    incomingSnapshot.fileDiffs.map((fileDiff) => [fileDiff.fileName, fileDiff]),
  )
  const orderedFileDiffs: ConversationFileDiff[] = []
  const retainedFilePaths = new Set<string>()

  for (const previousFileDiff of previousSnapshot.fileDiffs) {
    const incomingFileDiff = incomingDiffByPath.get(previousFileDiff.fileName)
    if (!incomingFileDiff) {
      continue
    }

    orderedFileDiffs.push(incomingFileDiff)
    retainedFilePaths.add(previousFileDiff.fileName)
  }

  for (const incomingFileDiff of incomingSnapshot.fileDiffs) {
    if (retainedFilePaths.has(incomingFileDiff.fileName)) {
      continue
    }

    orderedFileDiffs.push(incomingFileDiff)
  }

  return {
    fileDiffs: orderedFileDiffs,
    totalAddedLineCount: incomingSnapshot.totalAddedLineCount,
    totalRemovedLineCount: incomingSnapshot.totalRemovedLineCount,
  }
}
