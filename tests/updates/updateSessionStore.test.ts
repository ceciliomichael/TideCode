import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getUpdatesSessionSnapshot,
  requestAutomaticUpdateCheck,
  requestUpdateCheck,
  requestUpdateCheckForSettingsOpen,
} from '../../src/components/settings/updates/updatesSessionStore'

test('settings update checks reuse a launch check but stay fresh when launch checking is disabled', () => {
  let checkCount = 0
  const neverResolves = new Promise<never>(() => undefined)
  const fakeWindow = {
    tidecodeUpdates: {
      checkForUpdates: () => {
        checkCount += 1
        return neverResolves
      },
      getCachedUpdate: () => Promise.resolve(null),
      getCurrentVersion: () => Promise.resolve('1.2.7'),
      onUpdateState: () => () => undefined,
    },
  } as unknown as Window

  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })

  try {
    requestUpdateCheckForSettingsOpen()
    assert.equal(checkCount, 1)

    requestUpdateCheckForSettingsOpen()
    assert.equal(checkCount, 2)

    requestAutomaticUpdateCheck()
    assert.equal(checkCount, 2)
    assert.equal(getUpdatesSessionSnapshot().hasAutoChecked, true)

    requestUpdateCheckForSettingsOpen()
    assert.equal(checkCount, 2)

    requestUpdateCheck()
    assert.equal(checkCount, 3)
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
})
