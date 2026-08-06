import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldIgnoreWorkspaceWatchPath } from '../../electron/workspace/explorerWatchFilter'

test('shouldIgnoreWorkspaceWatchPath does not ignore ordinary nested files', () => {
  assert.equal(shouldIgnoreWorkspaceWatchPath('newfile.txt'), false)
  assert.equal(shouldIgnoreWorkspaceWatchPath('src/components/Button.tsx'), false)
  assert.equal(shouldIgnoreWorkspaceWatchPath('src\\components\\Button.tsx'), false)
  assert.equal(shouldIgnoreWorkspaceWatchPath(''), false)
})

test('shouldIgnoreWorkspaceWatchPath ignores paths inside ignored directories at any depth', () => {
  assert.equal(shouldIgnoreWorkspaceWatchPath('node_modules'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('node_modules/pkg/index.js'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('src/node_modules/pkg/index.js'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('.git/config'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('.next/cache/file'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('a/b/.venv/c/file'), true)
})

test('shouldIgnoreWorkspaceWatchPath ignores editor temp artifacts', () => {
  assert.equal(shouldIgnoreWorkspaceWatchPath('.file.js.swp'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('file.js~'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('.subl-abc.tmp'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('src/.file.ts.swx'), true)
})

test('shouldIgnoreWorkspaceWatchPath ignores temporary deletion markers', () => {
  assert.equal(shouldIgnoreWorkspaceWatchPath('.echodeleting_src'), true)
  assert.equal(shouldIgnoreWorkspaceWatchPath('src/.echodeleting_Button.tsx'), true)
})

test('shouldIgnoreWorkspaceWatchPath does not ignore build output directories', () => {
  assert.equal(shouldIgnoreWorkspaceWatchPath('dist/bundle.js'), false)
  assert.equal(shouldIgnoreWorkspaceWatchPath('target/debug/app'), false)
})
