import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { shouldIgnoreGitSourceControlWatchPath } from '../../electron/git/sourceControlWatchFilter'

test('watches Git metadata so external commits and branch changes are observable', () => {
  const workspacePath = path.resolve('source-control-test-workspace')

  assert.equal(
    shouldIgnoreGitSourceControlWatchPath(workspacePath, path.join(workspacePath, '.git', 'HEAD')),
    false,
  )
  assert.equal(
    shouldIgnoreGitSourceControlWatchPath(workspacePath, path.join(workspacePath, '.git', 'refs', 'heads', 'main')),
    false,
  )
})

test('ignores high-volume generated worktree directories but keeps normal files live', () => {
  const workspacePath = path.resolve('source-control-test-workspace')

  assert.equal(
    shouldIgnoreGitSourceControlWatchPath(workspacePath, path.join(workspacePath, 'node_modules', 'package', 'index.js')),
    true,
  )
  assert.equal(
    shouldIgnoreGitSourceControlWatchPath(workspacePath, path.join(workspacePath, 'src', 'feature.ts')),
    false,
  )
})
