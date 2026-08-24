import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getRoundedDownloadPercent,
  getTargetUpdateVersion,
  getUpdateActionPresentation,
} from '../../src/components/settings/updates/updateActionPresentation'

test('shows the available release as the target version before download starts', () => {
  assert.equal(
    getTargetUpdateVersion({
      downloadState: 'not-available',
      latestVersion: '1.2.22',
      pendingVersion: null,
      updateAvailable: true,
    }),
    '1.2.22',
  )
})

test('keeps the in-flight version as the target when a newer release is discovered', () => {
  assert.equal(
    getTargetUpdateVersion({
      downloadState: 'downloading',
      latestVersion: '1.2.23',
      pendingVersion: '1.2.22',
      updateAvailable: true,
    }),
    '1.2.22',
  )
})

test('clamps and rounds download progress for the live action label', () => {
  assert.equal(getRoundedDownloadPercent(null), 0)
  assert.equal(getRoundedDownloadPercent(48.6), 49)
  assert.equal(getRoundedDownloadPercent(120), 100)
})

test('uses live percentage as the button label while downloading', () => {
  assert.deepEqual(
    getUpdateActionPresentation({
      checkState: 'downloading',
      downloadPercent: 62.4,
      downloadState: 'downloading',
      hasResult: true,
      targetVersion: '1.2.22',
      updateAvailable: true,
    }),
    {
      ariaLabel: 'Downloading TideCode 1.2.22: 62%',
      disabled: true,
      kind: 'downloading',
      label: '62%',
    },
  )
})

test('download action keeps the button label version-free', () => {
  assert.deepEqual(
    getUpdateActionPresentation({
      checkState: 'success',
      downloadPercent: null,
      downloadState: 'not-available',
      hasResult: true,
      targetVersion: '1.2.22',
      updateAvailable: true,
    }),
    {
      ariaLabel: 'Download update',
      disabled: false,
      kind: 'download',
      label: 'Download update',
    },
  )
})

test('downloaded update becomes an icon-only restart action', () => {
  assert.deepEqual(
    getUpdateActionPresentation({
      checkState: 'success',
      downloadPercent: 100,
      downloadState: 'downloaded',
      hasResult: true,
      targetVersion: '1.2.22',
      updateAvailable: true,
    }),
    {
      ariaLabel: 'Restart to install update to TideCode 1.2.22',
      disabled: false,
      kind: 'restart',
      label: null,
    },
  )
})
