import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { shouldIgnoreProjectPathWatchEntry } from '../electron/history/projectPathWatch'

function normalize(candidatePath: string) {
  const resolvedPath = path.resolve(candidatePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

test('project path watcher ignores unrelated siblings in a watched parent directory', () => {
  const parentPath = path.resolve('watched-parent')
  const projectPath = path.join(parentPath, 'project')
  const officeTempPath = path.join(parentPath, 'mso2303.tmp')
  const allowedPaths = new Set([normalize(parentPath), normalize(projectPath)])

  assert.equal(shouldIgnoreProjectPathWatchEntry(parentPath, allowedPaths), false)
  assert.equal(shouldIgnoreProjectPathWatchEntry(projectPath, allowedPaths), false)
  assert.equal(shouldIgnoreProjectPathWatchEntry(officeTempPath, allowedPaths), true)
})
