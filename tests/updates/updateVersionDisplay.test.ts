import assert from 'node:assert/strict'
import test from 'node:test'
import { getDisplayedUpdateVersion } from '../../src/components/settings/updates/updateVersionDisplay'

test('uses the version already being downloaded for update status', () => {
  assert.equal(
    getDisplayedUpdateVersion({
      checkState: 'success',
      currentVersion: '1.1.2',
      downloadState: 'downloading',
      latestVersion: '1.1.4',
      pendingVersion: '1.1.3',
    }),
    '1.1.3',
  )
})

test('falls back to the latest version when an active download has no explicit version', () => {
  assert.equal(
    getDisplayedUpdateVersion({
      checkState: 'downloading',
      currentVersion: '1.1.2',
      downloadState: 'downloading',
      latestVersion: '1.1.3',
      pendingVersion: null,
    }),
    '1.1.3',
  )
})

test('uses the installed version when no download is active', () => {
  assert.equal(
    getDisplayedUpdateVersion({
      checkState: 'success',
      currentVersion: '1.1.2',
      downloadState: 'not-available',
      latestVersion: '1.1.3',
      pendingVersion: '1.1.3',
    }),
    '1.1.2',
  )
})
