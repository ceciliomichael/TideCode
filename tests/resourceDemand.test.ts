import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFileDiffSnapshot, projectGitFileDiffScope } from '../src/lib/chatDiffs'

test('Source Control metadata preserves staged and unstaged status without owning file text', () => {
  const snapshot = buildFileDiffSnapshot([{
    fileName: 'renamed.ts', originalFileName: 'old.ts', changeStatus: 'renamed',
    stagedChangeStatus: 'renamed', unstagedChangeStatus: 'deleted',
    isStaged: true, isUnstaged: true, isUntracked: false,
    oldContent: 'old', indexContent: 'indexed', newContent: '',
  }])
  const staged = projectGitFileDiffScope(snapshot.fileDiffs[0], 'staged', false)
  const unstaged = projectGitFileDiffScope(snapshot.fileDiffs[0], 'unstaged', false)
  assert.equal(staged.changeStatus, 'renamed')
  assert.equal(staged.originalFileName, 'old.ts')
  assert.equal(unstaged.changeStatus, 'deleted')
  assert.equal(unstaged.isDeleted, true)
  for (const row of [staged, unstaged]) {
    assert.equal(row.hasContent, false)
    assert.equal(row.oldContent, null)
    assert.equal(row.indexContent, null)
    assert.equal(row.newContent, '')
  }
  assert.equal(snapshot.fileDiffs[0].oldContent, 'old', 'the active editor baseline remains intact')
})

test('pending scope projection retains metadata without claiming to have file bodies', () => {
  const metadata = buildFileDiffSnapshot([{
    fileName: 'pending.ts', isStaged: true, isUnstaged: true, isUntracked: false,
    oldContent: null, newContent: '', addedLineCount: 9, removedLineCount: 4,
    stagedChangeStatus: 'added', unstagedChangeStatus: 'modified',
    stagedLineCounts: { addedLineCount: 0, removedLineCount: 0 },
    unstagedLineCounts: { addedLineCount: 3, removedLineCount: 2 },
  }], false).fileDiffs[0]
  for (const scope of ['staged', 'unstaged'] as const) {
    const projected = projectGitFileDiffScope(metadata, scope)
    assert.equal(projected.hasContent, false)
    assert.equal(projected.newContent, '')
    assert.equal(projected.oldContent, null)
    assert.equal(projected.addedLineCount, scope === 'staged' ? 0 : 3)
    assert.equal(projected.removedLineCount, scope === 'staged' ? 0 : 2)
    assert.equal(projected.changeStatus, scope === 'staged' ? 'added' : 'modified')
  }
})

test('native scoped counts stay the same before and after text hydration', () => {
  const payload = {
    fileName: 'partial.ts', isStaged: true, isUnstaged: true, isUntracked: false,
    oldContent: 'original\n', indexContent: 'staged\n', newContent: 'original\n',
    addedLineCount: 0, removedLineCount: 0,
    stagedLineCounts: { addedLineCount: 1, removedLineCount: 1 },
    unstagedLineCounts: { addedLineCount: 1, removedLineCount: 1 },
  }
  for (const includeContent of [false, true]) {
    const row = buildFileDiffSnapshot([payload], includeContent).fileDiffs[0]
    for (const scope of ['staged', 'unstaged'] as const) {
      const scoped = projectGitFileDiffScope(row, scope)
      assert.equal(scoped.addedLineCount, 1)
      assert.equal(scoped.removedLineCount, 1)
      assert.equal(scoped.hasContent, includeContent)
    }
  }
})
