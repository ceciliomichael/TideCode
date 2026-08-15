import test from 'node:test'
import assert from 'node:assert/strict'
import { getInstalledTideCodeExecutableCandidates } from '../../electron/cli/desktopAppLaunch'

test('desktop executable candidates include both Windows install casing variants', () => {
  assert.deepEqual(
    getInstalledTideCodeExecutableCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' }),
    [
      'C:\\Users\\Tester\\AppData\\Local\\Programs\\TideCode\\TideCode.exe',
      'C:\\Users\\Tester\\AppData\\Local\\Programs\\tidecode\\tidecode.exe',
    ],
  )
})

test('desktop executable candidates cover macOS and Linux packaged locations', () => {
  assert.deepEqual(
    getInstalledTideCodeExecutableCandidates('darwin', {}),
    ['/Applications/TideCode.app/Contents/MacOS/TideCode', '/Applications/tidecode.app/Contents/MacOS/tidecode'],
  )
  assert.deepEqual(
    getInstalledTideCodeExecutableCandidates('linux', { APPIMAGE: '/tmp/TideCode.AppImage' }),
    ['/tmp/TideCode.AppImage', '/opt/TideCode/tidecode', '/usr/bin/tidecode'],
  )
})

test('desktop executable candidates omit unavailable environment paths', () => {
  assert.deepEqual(getInstalledTideCodeExecutableCandidates('win32', {}), ['', ''])
  assert.deepEqual(
    getInstalledTideCodeExecutableCandidates('linux', {}),
    ['', '/opt/TideCode/tidecode', '/usr/bin/tidecode'],
  )
})
