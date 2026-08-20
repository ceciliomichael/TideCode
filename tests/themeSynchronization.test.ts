import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldDeferRendererSettingsCommit } from '../src/hooks/appSettingsUpdatePolicy'
import { applyPendingSettingsUpdates } from '../src/hooks/useAppSettings'
import { DEFAULT_APP_SETTINGS } from '../src/lib/defaultAppSettings'
import { hasDurableAppSettingsInput, preserveLocalWorkspaceUiSettings } from '../src/lib/appSettingsScopes'
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


test('remote settings snapshots preserve a pending local web selection', () => {
  const remoteSnapshot = {
    ...DEFAULT_APP_SETTINGS,
    appearance: 'dark' as const,
    chatModelId: 'remote-model',
    chatModelLabel: 'Remote model',
  }
  const visibleSettings = applyPendingSettingsUpdates(remoteSnapshot, [
    {
      deferRendererCommit: false,
      input: {
        chatModelId: 'local-model',
        chatModelLabel: 'Local model',
        chatReasoningEffort: 'high',
      },
    },
  ])

  assert.equal(visibleSettings.appearance, 'dark')
  assert.equal(visibleSettings.chatModelId, 'local-model')
  assert.equal(visibleSettings.chatModelLabel, 'Local model')
  assert.equal(visibleSettings.chatReasoningEffort, 'high')
})

test('deferred appearance updates wait for the committed canonical snapshot', () => {
  const currentSettings = { ...DEFAULT_APP_SETTINGS, appearance: 'dark' as const }
  const visibleSettings = applyPendingSettingsUpdates(currentSettings, [
    { deferRendererCommit: true, input: { appearance: 'light' } },
  ])

  assert.equal(visibleSettings.appearance, 'dark')
})


test('remote durable settings preserve local workspace UI state', () => {
  const localSettings = {
    ...DEFAULT_APP_SETTINGS,
    appearance: 'dark' as const,
    lastActiveConversationId: 'desktop-chat',
    sidebarWidth: 320,
  }
  const remoteSettings = {
    ...DEFAULT_APP_SETTINGS,
    appearance: 'light' as const,
    lastActiveConversationId: 'web-chat',
    sidebarWidth: 220,
  }

  const merged = preserveLocalWorkspaceUiSettings(remoteSettings, localSettings)
  assert.equal(merged.appearance, 'light')
  assert.equal(merged.lastActiveConversationId, 'desktop-chat')
  assert.equal(merged.sidebarWidth, 320)
})

test('workspace-only updates are not broadcast as durable settings changes', () => {
  assert.equal(hasDurableAppSettingsInput({ lastActiveConversationId: 'web-chat' }), false)
  assert.equal(hasDurableAppSettingsInput({ sidebarWidth: 280 }), false)
  assert.equal(hasDurableAppSettingsInput({ chatReasoningEffort: 'high' }), true)
  assert.equal(hasDurableAppSettingsInput({ appearance: 'dark' }), true)
})
