import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeExplorerRelativePath,
  resolveExplorerAbsolutePath,
} from '../src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerClipboardPaths'

test('explorer path copy preserves Windows absolute path separators', () => {
  assert.equal(
    resolveExplorerAbsolutePath('C:\\work\\project\\', 'src/components/App.tsx'),
    'C:\\work\\project\\src\\components\\App.tsx',
  )
})

test('explorer relative path copy normalizes separators without making the path absolute', () => {
  assert.equal(normalizeExplorerRelativePath('.\\src\\components\\App.tsx'), 'src/components/App.tsx')
})
