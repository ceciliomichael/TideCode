import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationDiffSnapshot } from '../../src/lib/chatDiffs'
import { appendNewDiffsToSnapshot } from '../../src/lib/diffSnapshotOrdering'

function createSnapshot(fileNames: readonly string[]): ConversationDiffSnapshot {
  return {
    fileDiffs: fileNames.map((fileName) => ({
      addedLineCount: 1,
      contentSignature: fileName,
      fileName,
      isDeleted: false,
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: fileName,
      oldContent: '',
      removedLineCount: 0,
    })),
    totalAddedLineCount: fileNames.length,
    totalRemovedLineCount: 0,
  }
}

test('appendNewDiffsToSnapshot preserves existing rows and appends new rows', () => {
  const nextSnapshot = appendNewDiffsToSnapshot(
    createSnapshot(['src/first.ts', 'src/second.ts']),
    createSnapshot(['src/new.ts', 'src/second.ts', 'src/first.ts']),
  )

  assert.deepEqual(
    nextSnapshot.fileDiffs.map((fileDiff) => fileDiff.fileName),
    ['src/first.ts', 'src/second.ts', 'src/new.ts'],
  )
})

test('appendNewDiffsToSnapshot removes files that no longer exist', () => {
  const nextSnapshot = appendNewDiffsToSnapshot(
    createSnapshot(['src/first.ts', 'src/second.ts']),
    createSnapshot(['src/second.ts']),
  )

  assert.deepEqual(
    nextSnapshot.fileDiffs.map((fileDiff) => fileDiff.fileName),
    ['src/second.ts'],
  )
})
