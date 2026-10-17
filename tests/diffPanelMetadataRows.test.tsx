import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationDiffFileItem } from '../src/components/chat/ConversationDiffFileItem'
import { buildFileDiffSnapshot, projectGitFileDiffScope } from '../src/lib/chatDiffs'

const metadata = buildFileDiffSnapshot([{
  fileName: 'src/pending.ts', isStaged: true, isUnstaged: true, isUntracked: false,
  oldContent: null, newContent: '', addedLineCount: 7, removedLineCount: 3,
  stagedLineCounts: { addedLineCount: 2, removedLineCount: 1 },
  unstagedLineCounts: { addedLineCount: 5, removedLineCount: 2 },
}], false).fileDiffs[0]
const noop = () => {}
const asyncNoop = async () => {}

function renderRow(isExpanded: boolean, hasContent = false) {
  return renderToStaticMarkup(createElement(ConversationDiffFileItem, {
    diff: { ...projectGitFileDiffScope(metadata, 'unstaged'), hasContent },
    isExpanded,
    onDiscardFile: asyncNoop,
    onExpandedChange: noop,
    onPreloadDiff: asyncNoop,
    onPrewarmDiff: noop,
    onStageFile: asyncNoop,
    onUnstageFile: asyncNoop,
    pendingFileActionPath: null,
    selectedScope: 'unstaged',
    shouldPrewarm: false,
    onPrewarmReady: noop,
  }))
}

test('expanded pending file retains its header and actions without attempting Monaco rendering', () => {
  const markup = renderRow(true)
  assert.match(markup, /pending.ts/u)
  assert.match(markup, /aria-expanded="true"/u)
  assert.match(markup, /aria-busy="true"/u)
  assert.match(markup, /aria-label="Stage src\/pending.ts"/u)
  assert.match(markup, /height:160px/u)
  assert.doesNotMatch(markup, /<!--|monaco-editor/u, 'pending content must not enter lazy Monaco/Suspense rendering')
  assert.match(markup, />\+5</u)
  assert.match(markup, />-2</u)
  assert.doesNotMatch(markup, />\+7<|>-3</u, 'aggregate counts must not be displayed as scoped counts')
})

test('collapsed pending file shows scoped counts before hydration and retains them afterward', () => {
  const pending = renderRow(false)
  assert.match(pending, /pending.ts/u)
  assert.match(pending, /height:53px/u)
  assert.match(pending, /aria-expanded="false"/u)
  assert.doesNotMatch(pending, /data-diff-content|height:160px|>\+7<|>-3</u)
  assert.match(pending, />\+5</u)
  assert.match(pending, />-2</u)
  const hydrated = renderRow(false, true)
  assert.match(hydrated, />\+5</u)
  assert.match(hydrated, />-2</u)
})

test('collapsed and expanded pending rows reserve the same header height and action column', () => {
  for (const expanded of [false, true]) {
    const markup = renderRow(expanded)
    assert.match(markup, /data-diff-file-header="src\/pending.ts"/u)
    assert.match(markup, /style="height:52px"/u)
    assert.match(markup, /w-\[4\.5rem\] justify-end/u)
    assert.match(markup, /inline-flex shrink-0 items-center/u, 'counts must retain their width beside truncated paths')
  }
})
