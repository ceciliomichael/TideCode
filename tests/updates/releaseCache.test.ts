import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildCachedUpdateCheckResult,
  createUpdateReleaseCacheStore,
  parseCachedUpdateRelease,
} from '../../electron/updates/releaseCache'

const cachedRelease = {
  checkedAt: '2026-08-03T12:00:00.000Z',
  release: {
    body: 'A persisted release description.',
    htmlUrl: 'https://github.com/ceciliomichael/TideCode/releases/tag/v1.0.3',
    name: 'TideCode v1.0.3',
    publishedAt: '2026-08-03T11:00:00.000Z',
    tagName: 'v1.0.3',
    version: '1.0.3',
  },
}

test('release metadata survives a cache-store reload and rebuilds update availability', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'tidecode-release-cache-'))

  try {
    const firstStore = createUpdateReleaseCacheStore(temporaryDirectory)
    await firstStore.write(cachedRelease)

    const secondStore = createUpdateReleaseCacheStore(temporaryDirectory)
    const restored = await secondStore.read()
    assert.deepEqual(restored, cachedRelease)

    const result = buildCachedUpdateCheckResult('1.0.2', restored as typeof cachedRelease)
    assert.equal(result.release.body, 'A persisted release description.')
    assert.equal(result.updateAvailable, true)
    assert.equal(result.downloadState, 'not-available')
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('cached release validation rejects unrelated or malformed metadata', () => {
  assert.equal(parseCachedUpdateRelease({ ...cachedRelease, release: { ...cachedRelease.release, htmlUrl: 'https://example.com/release' } }), null)
  assert.equal(parseCachedUpdateRelease({ ...cachedRelease, release: { ...cachedRelease.release, version: 'latest' } }), null)
})
