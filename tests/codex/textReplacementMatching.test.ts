import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findExactMatchOffsets,
  findIndentationTolerantMatchOffsets,
} from '../../electron/chat/shared/tools/textReplacementMatching'

test('indentation-tolerant matching accepts different leading spaces and tabs', () => {
  const content = ['if (ready) {', '            return true', '}'].join('\n')
  const target = ['if (ready) {', '\t  return true', '}'].join('\n')

  assert.deepEqual(findIndentationTolerantMatchOffsets(content, target), [
    { endOffset: content.length, startOffset: 0 },
  ])
})

test('indentation-tolerant matching does not ignore meaningful text differences', () => {
  const content = '            return true'

  assert.deepEqual(
    findIndentationTolerantMatchOffsets(content, '          return false'),
    [],
  )
})

test('exact matching preserves all match offsets and lengths', () => {
  const content = 'const value = 1\nconst value = 1\n'

  assert.deepEqual(findExactMatchOffsets(content, 'const value = 1'), [
    { endOffset: 15, startOffset: 0 },
    { endOffset: 31, startOffset: 16 },
  ])
})
