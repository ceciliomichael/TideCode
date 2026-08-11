import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isWorkspaceFileCacheEntryFresh,
  shouldRetainConsumedWorkspaceFile,
  TEXT_FILE_PREFETCH_TTL_MS,
} from '../../../src/lib/workspaceFileCachePolicy'

test('text-file prefetch entries expire while preview entries remain reusable', () => {
  const createdAt = 1_000

  assert.equal(
    isWorkspaceFileCacheEntryFresh(createdAt, createdAt + TEXT_FILE_PREFETCH_TTL_MS, false),
    true,
  )
  assert.equal(
    isWorkspaceFileCacheEntryFresh(createdAt, createdAt + TEXT_FILE_PREFETCH_TTL_MS + 1, false),
    false,
  )
  assert.equal(
    isWorkspaceFileCacheEntryFresh(createdAt, createdAt + TEXT_FILE_PREFETCH_TTL_MS + 1, true),
    true,
  )
})

test('an actual open consumes its prefetched text-file entry', () => {
  assert.equal(shouldRetainConsumedWorkspaceFile(undefined), true)
  assert.equal(shouldRetainConsumedWorkspaceFile(false), true)
  assert.equal(shouldRetainConsumedWorkspaceFile(true), false)
})
