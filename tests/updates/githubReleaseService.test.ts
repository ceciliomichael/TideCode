import assert from 'node:assert/strict'
import test from 'node:test'
import { checkForUpdates, TIDECODE_GITHUB_REPOSITORY } from '../../electron/updates/githubReleaseService'

test('checks the official latest release and detects a newer version', async () => {
  const requestRelease = async () => ({
    body: 'Bug fixes and improvements.',
    html_url: `https://github.com/${TIDECODE_GITHUB_REPOSITORY}/releases/tag/v1.0.2`,
    name: 'TideCode v1.0.2',
    published_at: '2026-08-02T12:00:00Z',
    tag_name: 'v1.0.2',
  })

  const result = await checkForUpdates('1.0.1', requestRelease)

  assert.equal(result.currentVersion, '1.0.1')
  assert.equal(result.latestVersion, '1.0.2')
  assert.equal(result.updateAvailable, true)
  assert.equal(result.release.body, 'Bug fixes and improvements.')
})

test('rejects a release link outside the official TideCode repository', async () => {
  const requestRelease = async () => ({
    html_url: 'https://example.com/releases/tag/v1.0.2',
    tag_name: 'v1.0.2',
  })

  await assert.rejects(() => checkForUpdates('1.0.1', requestRelease), /invalid TideCode release/)
})

test('surfaces a friendly error for a failed GitHub response', async () => {
  const requestRelease = async () => {
    throw new Error('GitHub could not be reached right now (HTTP 403).')
  }

  await assert.rejects(() => checkForUpdates('1.0.1', requestRelease), /HTTP 403/)
})
