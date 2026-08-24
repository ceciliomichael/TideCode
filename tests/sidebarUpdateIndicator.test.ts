import assert from 'node:assert/strict'
import test from 'node:test'
import { getSidebarUpdateIndicator } from '../src/components/sidebar/sidebarUpdateIndicator'

test('shows the download icon state when an update is available', () => {
  assert.deepEqual(
    getSidebarUpdateIndicator({
      downloadPercent: null,
      downloadState: 'not-available',
      updateAvailable: true,
    }),
    {
      ariaLabel: 'Open Updates',
      kind: 'download',
      label: null,
    },
  )
})

test('shows only the rounded live percentage while downloading', () => {
  assert.deepEqual(
    getSidebarUpdateIndicator({
      downloadPercent: 62.4,
      downloadState: 'downloading',
      updateAvailable: true,
    }),
    {
      ariaLabel: 'Update download 62%',
      kind: 'downloading',
      label: '62%',
    },
  )
})

test('shows restart state after the update has downloaded', () => {
  assert.deepEqual(
    getSidebarUpdateIndicator({
      downloadPercent: 100,
      downloadState: 'downloaded',
      updateAvailable: true,
    }),
    {
      ariaLabel: 'Restart to install update',
      kind: 'restart',
      label: null,
    },
  )
})

test('hides the indicator when no update is available', () => {
  assert.deepEqual(
    getSidebarUpdateIndicator({
      downloadPercent: null,
      downloadState: 'not-available',
      updateAvailable: false,
    }),
    {
      ariaLabel: '',
      kind: 'hidden',
      label: null,
    },
  )
})
