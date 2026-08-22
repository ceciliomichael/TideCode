import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampTerminalPollingMs,
  MAX_TERMINAL_POLLING_MS,
  resolveTerminalShellSpec,
} from '../../electron/terminal/configuration'

test('terminal polling defaults to and never exceeds the five-minute read limit', () => {
  assert.equal(clampTerminalPollingMs(undefined), MAX_TERMINAL_POLLING_MS)
  assert.equal(clampTerminalPollingMs(MAX_TERMINAL_POLLING_MS + 1), MAX_TERMINAL_POLLING_MS)
  assert.equal(clampTerminalPollingMs(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampTerminalPollingMs(-1), 0)
})

test('Windows terminal resolution requires PowerShell 7 and never falls back to Windows PowerShell or cmd', () => {
  const environment = {
    LOCALAPPDATA: 'C:/Users/test/AppData/Local',
    PATH: '',
    ProgramFiles: 'C:/Program Files',
  }
  const shell = resolveTerminalShellSpec({
    env: environment,
    isCommandAvailable: (command) => command.includes('WindowsApps') && command.endsWith('pwsh.exe'),
    platform: 'win32',
  })

  assert.equal(shell.label, 'PowerShell 7')
  assert.match(shell.command, /WindowsApps.*pwsh\.exe/u)
  assert.doesNotMatch(shell.args.join(' '), /PSReadLine/u)

  assert.throws(
    () => resolveTerminalShellSpec({
      env: environment,
      isCommandAvailable: (command) => command.endsWith('powershell.exe') || command.endsWith('cmd.exe'),
      platform: 'win32',
    }),
    /PowerShell 7 .* is required on Windows/u,
  )
})

test('macOS and Linux use only the configured account login shell', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const shell = resolveTerminalShellSpec({
      env: { SHELL: '/custom/bin/zsh' },
      isCommandAvailable: (command) => command === '/custom/bin/zsh',
      platform,
    })
    assert.equal(shell.command, '/custom/bin/zsh')
    assert.equal(shell.label, 'zsh')
    assert.deepEqual(shell.args, ['-l'])

    assert.throws(
      () => resolveTerminalShellSpec({
        env: {},
        isCommandAvailable: () => true,
        platform,
      }),
      /SHELL is not set/u,
    )
  }
})
