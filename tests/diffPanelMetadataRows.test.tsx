import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConversationDiffFileItem, type DiffPanelScope } from '../src/components/chat/ConversationDiffFileItem'
import { DiffFileHeader, PANEL_DIFF_ROW_HEIGHT_PX } from '../src/components/chat/DiffFileHeader'
import { VirtualizedConversationDiffFileList } from '../src/components/chat/VirtualizedConversationDiffFileList'
import { buildFileDiffSnapshot, projectGitFileDiffScope, type ConversationFileDiff } from '../src/lib/chatDiffs'

const metadata = buildFileDiffSnapshot([{
  fileName: 'src/pending.ts',
  changeStatus: 'modified',
  isStaged: true,
  isUnstaged: true,
  isUntracked: false,
  oldContent: null,
  newContent: '',
  addedLineCount: 7,
  removedLineCount: 3,
  stagedLineCounts: { addedLineCount: 2, removedLineCount: 1 },
  unstagedLineCounts: { addedLineCount: 5, removedLineCount: 2 },
}], false).fileDiffs[0]
const noop = () => {}
const asyncNoop = async () => {}

function renderRow(
  isExpanded: boolean,
  overrides: Partial<ConversationFileDiff> = {},
  selectedScope: DiffPanelScope = 'unstaged',
  pendingFileActionPath: string | null = null,
) {
  return renderToStaticMarkup(createElement(ConversationDiffFileItem, {
    diff: { ...projectGitFileDiffScope(metadata, 'unstaged'), hasContent: false, ...overrides },
    isExpanded,
    onDiscardFile: asyncNoop,
    onExpandedChange: noop,
    onPreloadDiff: asyncNoop,
    onPrewarmDiff: noop,
    onStageFile: asyncNoop,
    onUnstageFile: asyncNoop,
    pendingFileActionPath,
    selectedScope,
    shouldPrewarm: false,
    onPrewarmReady: noop,
  }))
}

test('expanded pending file retains its status and actions without attempting Monaco rendering', () => {
  const markup = renderRow(true)
  assert.match(markup, /pending.ts/u)
  assert.match(markup, /aria-expanded="true"/u)
  assert.match(markup, /aria-busy="true"/u)
  assert.match(markup, /aria-label="Stage src\/pending.ts"/u)
  assert.match(markup, /data-diff-content="true"/u)
  assert.match(markup, /text-git-modified">M</u)
  assert.doesNotMatch(markup, /<!--|monaco-editor/u, 'pending content must not enter lazy Monaco/Suspense rendering')
  assert.doesNotMatch(markup, />\+\d+<|>-\d+</u, 'panel rows show status letters instead of inline line counts')
})

test('collapsed rows retain Source Control sizing and status before and after hydration', () => {
  assert.equal(PANEL_DIFF_ROW_HEIGHT_PX, 49)
  for (const hasContent of [false, true]) {
    const markup = renderRow(false, { hasContent })
    assert.match(markup, /pending.ts/u)
    assert.match(markup, /height:49px/u)
    assert.match(markup, /aria-expanded="false"/u)
    assert.match(markup, /text-git-modified">M</u)
    assert.match(markup, /border-border\/60/u)
    assert.match(markup, /hover:bg-surface-muted\/50/u)
    assert.doesNotMatch(markup, /data-diff-content|>\+\d+<|>-\d+</u)
  }
})

test('collapsed and expanded pending rows reserve the same header height and action column', () => {
  for (const expanded of [false, true]) {
    const markup = renderRow(expanded)
    assert.match(markup, /data-diff-file-header="src\/pending.ts"/u)
    assert.match(markup, /style="height:48px"/u)
    assert.match(markup, /w-\[4\.5rem\] justify-end/u)
    assert.match(markup, /shrink-0 text-\[10px\] font-bold/u, 'status remains visible beside truncated paths')
  }
})

test('panel rows render Git statuses and deleted names consistently in both expansion states', () => {
  const statuses = [
    ['modified', 'M', 'text-git-modified'],
    ['added', 'A', 'text-git-added'],
    ['untracked', 'U', 'text-git-added'],
    ['renamed', 'R', 'text-git-renamed'],
    ['conflicted', 'U', 'text-danger-foreground'],
    ['deleted', 'D', 'text-git-removed'],
  ] as const
  for (const [changeStatus, label, color] of statuses) {
    for (const expanded of [false, true]) {
      const markup = renderRow(expanded, {
        changeStatus,
        isDeleted: changeStatus === 'deleted',
        originalFileName: changeStatus === 'renamed' ? 'src/previous.ts' : undefined,
      })
      assert.ok(markup.includes(`${color}">${label}</span>`), `${changeStatus} status must match Source Control`)
      if (changeStatus === 'deleted') {
        assert.match(markup, /line-through/u)
      }
      if (changeStatus === 'renamed') {
        assert.match(markup, /Renamed from src\/previous.ts/u)
      }
    }
  }
})

test('staged and unstaged actions remain scoped and disable while pending', () => {
  for (const expanded of [false, true]) {
    const staged = renderRow(expanded, {}, 'staged', 'src/pending.ts')
    assert.match(staged, /aria-label="Unstage src\/pending.ts" disabled=""/u)
    assert.doesNotMatch(staged, /aria-label="Stage |aria-label="Discard /u)
    const unstaged = renderRow(expanded, {}, 'unstaged', 'src/pending.ts')
    assert.match(unstaged, /aria-label="Stage src\/pending.ts" disabled=""/u)
    assert.match(unstaged, /aria-label="Discard src\/pending.ts" disabled=""/u)
  }
})

test('virtualized panel rows use the same 49-pixel spacing as rendered rows', () => {
  const diffs = Array.from({ length: 30 }, (_, index) => ({
    ...metadata,
    fileName: `src/file-${index}.ts`,
  }))
  const markup = renderToStaticMarkup(createElement(VirtualizedConversationDiffFileList, {
    diffs,
    expandedFilePathSet: new Set<string>(),
    onPreloadDiff: asyncNoop,
    prewarmEnabled: false,
    onDiscardFile: asyncNoop,
    onExpandedChange: noop,
    onStageFile: asyncNoop,
    onUnstageFile: asyncNoop,
    pendingFileActionPath: null,
    selectedScope: 'unstaged',
  }))
  assert.match(markup, /top:49px/u)
  assert.match(markup, /top:98px/u)
  assert.match(markup, /height:1470px/u)
  assert.doesNotMatch(markup, /top:53px|height:1590px/u)
})

test('ordinary chat diff headers retain their existing appearance and inline content', () => {
  const markup = renderToStaticMarkup(createElement(DiffFileHeader, {
    filePath: 'src/chat.ts',
    collapsible: true,
    isExpanded: false,
    stableLayout: true,
    inlineContent: createElement('span', {}, '+5'),
  }))
  assert.match(markup, /height:52px/u)
  assert.match(markup, />\+5</u)
  assert.doesNotMatch(markup, /font-bold|hover:bg-surface-muted\/50/u)
})
