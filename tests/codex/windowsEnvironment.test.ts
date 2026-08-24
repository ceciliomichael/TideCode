import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseWindowsRegistryStringValue,
  refreshWindowsPathEnvironment,
} from '../../electron/terminal/windowsEnvironment'

test('parses REG_SZ and REG_EXPAND_SZ registry values', () => {
  const output = `
HKEY_CURRENT_USER\\Environment
    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Roaming\\npm
  `

  assert.equal(
    parseWindowsRegistryStringValue(output, 'Path'),
    '%USERPROFILE%\\AppData\\Roaming\\npm',
  )
  assert.equal(
    parseWindowsRegistryStringValue('Path    REG_SZ    C:\\Tools', 'Path'),
    'C:\\Tools',
  )
})

test('refreshes stale Windows PATH values from user and machine environment registries', () => {
  const registryValues = new Map([
    ['HKCU\\Environment|Path', '%USERPROFILE%\\AppData\\Roaming\\npm;C:\\UserTools'],
    [
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment|Path',
      '%ProgramFiles%\\Common Tools;C:\\Windows\\System32',
    ],
  ])
  const environment = {
    Path: 'C:\\Windows\\System32;C:\\ExistingTools',
    USERPROFILE: 'C:\\Users\\test',
    ProgramFiles: 'C:\\Program Files',
  }

  const refreshed = refreshWindowsPathEnvironment(environment, {
    platform: 'win32',
    readRegistryValue: (keyPath, valueName) =>
      registryValues.get(`${keyPath}|${valueName}`) ?? null,
  })

  assert.equal(
    refreshed.Path,
    'C:\\Windows\\System32;C:\\ExistingTools;C:\\Users\\test\\AppData\\Roaming\\npm;C:\\UserTools;C:\\Program Files\\Common Tools',
  )
  assert.equal(refreshed.USERPROFILE, environment.USERPROFILE)
})

test('keeps non-Windows environments unchanged', () => {
  const environment = { PATH: '/usr/bin:/bin' }
  assert.deepEqual(
    refreshWindowsPathEnvironment(environment, { platform: 'linux' }),
    environment,
  )
})
