import assert from 'node:assert/strict'
import test from 'node:test'
import { computeDiffLines, getDiffSummary } from '../../src/lib/textDiff'

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

test('diff counting ignores CRLF versus LF line-ending differences', () => {
  const oldContent = ['first', 'second', 'third'].join('\r\n') + '\r\n'
  const newContent = ['first', 'updated', 'third'].join('\n') + '\n'

  const diffLines = computeDiffLines(oldContent, newContent)
  const summary = getDiffSummary(oldContent, newContent)

  assert.equal(diffLines.filter((line) => line.type === 'unchanged').length, 3)
  assert.deepEqual(summary, {
    addedLineCount: 1,
    removedLineCount: 1,
  })
})

test('diff counting keeps a small edit accurate in a larger file', () => {
  const oldLines = Array.from({ length: 600 }, (_, index) => `line-${index + 1}`)
  const newLines = [...oldLines]
  newLines.splice(300, 1, ...Array.from({ length: 60 }, (_, index) => `replacement-${index + 1}`))

  const diffLines = computeDiffLines(oldLines.join('\n'), newLines.join('\n'))
  const summary = getDiffSummary(oldLines.join('\n'), newLines.join('\n'))

  assert.equal(diffLines.filter((line) => line.type === 'unchanged').length, 599)
  assert.deepEqual(summary, {
    addedLineCount: 60,
    removedLineCount: 1,
  })
})

test('diff counting remains accurate beyond the exact diff matrix limit', () => {
  const oldLines = Array.from({ length: 2000 }, (_, index) => `line-${index + 1}`)
  const newLines = [...oldLines]
  newLines[500] = 'changed-500'
  newLines[1500] = 'changed-1500'

  assert.deepEqual(getDiffSummary(oldLines.join('\n'), newLines.join('\n')), {
    addedLineCount: 2,
    removedLineCount: 2,
  })
})
