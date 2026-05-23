import assert from 'node:assert/strict'
import test from 'node:test'
import { computeDiffLines } from '../../src/lib/textDiff'

test('computeDiffLines keeps the shared anchor line in place for small edit blocks', () => {
  const oldContent = [...Array.from({ length: 50 }, (_, index) => `old-${index + 1}`), 'ANCHOR'].join('\n')
  const newContent = ['ANCHOR', ...Array.from({ length: 50 }, (_, index) => `new-${index + 1}`)].join('\n')

  const diffLines = computeDiffLines(oldContent, newContent)

  assert.equal(diffLines.filter((line) => line.type === 'unchanged' && line.content === 'ANCHOR').length, 1)
  assert.equal(diffLines.filter((line) => line.type === 'removed').length, 50)
  assert.equal(diffLines.filter((line) => line.type === 'added').length, 50)
})

test('computeDiffLines keeps old and new line numbers separate after inserted lines', () => {
  const oldContent = ['first', 'second', 'third'].join('\n')
  const newContent = ['first', 'inserted', 'second', 'third'].join('\n')

  const diffLines = computeDiffLines(oldContent, newContent)
  const secondLine = diffLines.find((line) => line.content === 'second' && line.type === 'unchanged')

  assert.ok(secondLine)
  assert.equal(secondLine?.oldLineNumber, 2)
  assert.equal(secondLine?.newLineNumber, 3)
})
