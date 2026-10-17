import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationDiffSnapshot } from '../../src/lib/chatDiffs'
import { mergeGitStatusSnapshot } from '../../src/hooks/useGitDiffSnapshot'

const EMPTY_SNAPSHOT: ConversationDiffSnapshot = {
  fileDiffs: [],
  totalAddedLineCount: 0,
  totalRemovedLineCount: 0,
}

test('full-content diff state shows new metadata rows before their bodies arrive', () => {
  const statusSnapshot: ConversationDiffSnapshot = {
    fileDiffs: [{
      addedLineCount: 0,
      hasContent: false,
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

  assert.deepEqual(mergeGitStatusSnapshot(EMPTY_SNAPSHOT, statusSnapshot), statusSnapshot)
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
      hasContent: false,
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

  const merged = mergeGitStatusSnapshot(currentSnapshot, statusSnapshot)
  assert.equal(merged.fileDiffs[0]?.newContent, 'const value = 2\n')
  assert.equal(merged.fileDiffs[0]?.oldContent, 'const value = 1\n')
  assert.equal(merged.fileDiffs[0]?.addedLineCount, 1)
  assert.equal(merged.fileDiffs[0]?.removedLineCount, 1)
  assert.equal(merged.fileDiffs[0]?.isStaged, true)
  assert.equal(merged.fileDiffs[0]?.isUnstaged, false)
})

test('pending metadata updates its counts and removes vanished files before content hydration', () => {
  const pending = {
    hasContent: false, addedLineCount: 1, removedLineCount: 0, contentSignature: 'status',
    fileName: 'pending.ts', isDeleted: false, isStaged: false, isUnstaged: true,
    isUntracked: false, newContent: '', oldContent: null,
  }
  const current: ConversationDiffSnapshot = {
    fileDiffs: [pending, { ...pending, fileName: 'gone.ts' }],
    totalAddedLineCount: 2, totalRemovedLineCount: 0,
  }
  const latest: ConversationDiffSnapshot = {
    fileDiffs: [{ ...pending, addedLineCount: 7 }],
    totalAddedLineCount: 7, totalRemovedLineCount: 0,
  }
  assert.deepEqual(mergeGitStatusSnapshot(current, latest), latest)
})

test('status reconciliation applies scope-only count changes while preserving loaded text', () => {
  const file = {
    hasContent: true, addedLineCount: 0, removedLineCount: 0, contentSignature: 'full',
    fileName: 'partial.ts', isDeleted: false, isStaged: true, isUnstaged: true,
    isUntracked: false, newContent: 'original', oldContent: 'original', indexContent: 'staged',
    stagedLineCounts: { addedLineCount: 1, removedLineCount: 1 },
    unstagedLineCounts: { addedLineCount: 1, removedLineCount: 1 },
  }
  const current: ConversationDiffSnapshot = { fileDiffs: [file], totalAddedLineCount: 0, totalRemovedLineCount: 0 }
  const status: ConversationDiffSnapshot = {
    ...current,
    fileDiffs: [{ ...file, hasContent: false, oldContent: null, indexContent: null, newContent: '',
      stagedLineCounts: { addedLineCount: 2, removedLineCount: 1 },
      unstagedLineCounts: { addedLineCount: 1, removedLineCount: 2 } }],
  }
  const merged = mergeGitStatusSnapshot(current, status).fileDiffs[0]
  assert.deepEqual(merged.stagedLineCounts, status.fileDiffs[0].stagedLineCounts)
  assert.deepEqual(merged.unstagedLineCounts, status.fileDiffs[0].unstagedLineCounts)
  assert.equal(merged.oldContent, 'original')
  assert.equal(merged.newContent, 'original')
  assert.equal(merged.indexContent, 'staged')
  assert.equal(merged.hasContent, true)
})
