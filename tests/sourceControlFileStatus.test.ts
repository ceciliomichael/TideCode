import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitHistoryCommitFile } from '../src/types/chat'
import { isDeletedCommitFile } from '../src/components/sourceControl/commitFileStatus'

function file(path: string, status: string): GitHistoryCommitFile {
  return { path, status }
}

test('top-level modified files are not rendered as deleted', () => {
  assert.equal(isDeletedCommitFile(file('CHANGELOG.md', 'M')), false)
  assert.equal(isDeletedCommitFile(file('package.json', 'M')), false)
})

test('nested modified and renamed files are not rendered as deleted', () => {
  assert.equal(isDeletedCommitFile(file('src/components/App.tsx', 'M')), false)
  assert.equal(isDeletedCommitFile(file('src/components/App.tsx', 'R100')), false)
})

test('deleted files keep the deleted presentation', () => {
  assert.equal(isDeletedCommitFile(file('src/removed.ts', 'D')), true)
  assert.equal(isDeletedCommitFile(file('src/removed.ts', 'D100')), true)
})
