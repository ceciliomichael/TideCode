import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationDiffSnapshot } from '../../src/lib/chatDiffs'
import { mergeGitStatusSnapshot } from '../../src/hooks/useGitDiffSnapshot'

const EMPTY_SNAPSHOT: ConversationDiffSnapshot = {
  fileDiffs: [],
  totalAddedLineCount: 0,
  totalRemovedLineCount: 0,
}

test('full-content diff state never inserts status-only placeholder rows', () => {
  const statusSnapshot: ConversationDiffSnapshot = {
    fileDiffs: [{
      addedLineCount: 0,
      contentSignature: 'status-only',
      fileName: 'src/new-file.ts',
      isDeleted: false,
      isStaged: false,
      isUnstaged: true,
      isUntracked: true,
      newContent: '',
      oldContent: null,
      removedLineCount: 0,
    }],
    totalAddedLineCount: 0,
    totalRemovedLineCount: 0,
  }

  assert.deepEqual(mergeGitStatusSnapshot(EMPTY_SNAPSHOT, statusSnapshot, true), EMPTY_SNAPSHOT)
})

test('status refresh updates flags while preserving full diff contents', () => {
  const currentSnapshot: ConversationDiffSnapshot = {
    fileDiffs: [{
      addedLineCount: 1,
      contentSignature: 'full-content',
      fileName: 'src/example.ts',
      isDeleted: false,
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: 'const value = 2\n',
      oldContent: 'const value = 1\n',
      removedLineCount: 1,
    }],
    totalAddedLineCount: 1,
    totalRemovedLineCount: 1,
  }
  const statusSnapshot: ConversationDiffSnapshot = {
    fileDiffs: [{
      addedLineCount: 0,
      contentSignature: 'status-only',
      fileName: 'src/example.ts',
      isDeleted: false,
      isStaged: true,
      isUnstaged: false,
      isUntracked: false,
      newContent: '',
      oldContent: null,
      removedLineCount: 0,
    }],
    totalAddedLineCount: 0,
    totalRemovedLineCount: 0,
  }

  const merged = mergeGitStatusSnapshot(currentSnapshot, statusSnapshot, true)
  assert.equal(merged.fileDiffs[0]?.newContent, 'const value = 2\n')
  assert.equal(merged.fileDiffs[0]?.oldContent, 'const value = 1\n')
  assert.equal(merged.fileDiffs[0]?.addedLineCount, 1)
  assert.equal(merged.fileDiffs[0]?.removedLineCount, 1)
  assert.equal(merged.fileDiffs[0]?.isStaged, true)
  assert.equal(merged.fileDiffs[0]?.isUnstaged, false)
})
