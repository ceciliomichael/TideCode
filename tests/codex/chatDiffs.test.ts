import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFileDiffSnapshot } from '../../src/lib/chatDiffs'

test('buildFileDiffSnapshot changes content signatures when diff content changes with the same length', () => {
  const leftSnapshot = buildFileDiffSnapshot([
    {
      fileName: 'src/example.ts',
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: 'const value = 1\n',
      oldContent: 'const value = 0\n',
    },
  ])
  const rightSnapshot = buildFileDiffSnapshot([
    {
      fileName: 'src/example.ts',
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: 'const value = 2\n',
      oldContent: 'const value = 0\n',
    },
  ])

  assert.notEqual(leftSnapshot.fileDiffs[0]?.contentSignature, rightSnapshot.fileDiffs[0]?.contentSignature)
})

test('buildFileDiffSnapshot keeps content signatures stable for identical diff content', () => {
  const firstSnapshot = buildFileDiffSnapshot([
    {
      fileName: 'src/example.ts',
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: 'const value = 1\n',
      oldContent: 'const value = 0\n',
    },
  ])
  const secondSnapshot = buildFileDiffSnapshot([
    {
      fileName: 'src/example.ts',
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: 'const value = 1\n',
      oldContent: 'const value = 0\n',
    },
  ])

  assert.equal(firstSnapshot.fileDiffs[0]?.contentSignature, secondSnapshot.fileDiffs[0]?.contentSignature)
})

test('buildFileDiffSnapshot counts content changes correctly across line-ending styles', () => {
  const snapshot = buildFileDiffSnapshot([
    {
      fileName: 'src/example.ts',
      isStaged: false,
      isUnstaged: true,
      isUntracked: false,
      newContent: 'first\nupdated\nthird\n',
      oldContent: 'first\r\nsecond\r\nthird\r\n',
    },
  ])

  assert.equal(snapshot.fileDiffs[0]?.addedLineCount, 1)
  assert.equal(snapshot.fileDiffs[0]?.removedLineCount, 1)
  assert.equal(snapshot.totalAddedLineCount, 1)
  assert.equal(snapshot.totalRemovedLineCount, 1)
})
