import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInitialSettingsArg, serializeInitialSettingsArg } from '../electron/settings/bootstrap'
import { DEFAULT_APP_SETTINGS } from '../src/lib/defaultAppSettings'

test('update checks are enabled at launch by default', () => {
  assert.equal(DEFAULT_APP_SETTINGS.checkForUpdatesOnLaunch, true)
})

test('parseInitialSettingsArg preserves a disabled update launch preference', () => {
  const parsedSettings = parseInitialSettingsArg([
    'tidecode.exe',
    serializeInitialSettingsArg({
      ...DEFAULT_APP_SETTINGS,
      checkForUpdatesOnLaunch: false,
    }),
  ])

  assert.equal(parsedSettings.checkForUpdatesOnLaunch, false)
})
