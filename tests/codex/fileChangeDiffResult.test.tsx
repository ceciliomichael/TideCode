import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChangeDiffResult } from '../../src/components/chat/FileChangeDiffResult'

test('same-file change hunks render inside one diff card with one file header', () => {
  const markup = renderToStaticMarkup(createElement(ChangeDiffResult, {
    parsedResult: {
      kind: 'change_diff',
      changes: [
        {
          fileName: 'src/kanbanContracts.ts',
          kind: 'update',
          oldContent: "'blocked',",
          newContent: "'for-review',",
          startLineNumber: 10,
        },
        {
          fileName: 'src/kanbanContracts.ts',
          kind: 'update',
          oldContent: "blocked: 'Blocked',",
          newContent: "'for-review': 'For Review',",
          startLineNumber: 20,
        },
      ],
    },
  }))

  assert.equal(markup.split('px-4 py-3 text-[12px] text-muted-foreground').length - 1, 1)
  assert.equal(markup.split('height:160px').length - 1, 2)
  assert.equal(markup.split('rounded-2xl border border-border').length - 1, 1)
})
