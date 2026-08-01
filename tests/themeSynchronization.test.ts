import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDeferRendererSettingsCommit } from '../src/hooks/appSettingsUpdatePolicy'
import { cacheAppearancePreference, THEME_STORAGE_KEY } from '../src/lib/theme'

test('appearance updates wait for the native window theme before committing in the renderer', () => {
  assert.equal(shouldDeferRendererSettingsCommit({ appearance: 'dark' }), true)
  assert.equal(shouldDeferRendererSettingsCommit({ appearance: 'system' }), true)
  assert.equal(shouldDeferRendererSettingsCommit({ language: 'en-US' }), false)
})

test('appearance caching updates local storage without issuing another settings request', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const writes: Array<{ key: string; value: string }> = []
  let settingsUpdateCount = 0

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeSettings: {
        updateSettings: () => {
          settingsUpdateCount += 1
        },
      },
      localStorage: {
        setItem: (key: string, value: string) => {
          writes.push({ key, value })
        },
      },
    },
  })

  try {
    cacheAppearancePreference('dark')

    assert.deepEqual(writes, [{ key: THEME_STORAGE_KEY, value: 'dark' }])
    assert.equal(settingsUpdateCount, 0)
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})
