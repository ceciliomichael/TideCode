import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampTerminalPollingMs,
  MAX_TERMINAL_POLLING_MS,
  resolveTerminalShellSpec,
} from '../../electron/terminal/configuration'
import {
  createWindowsShellCandidates,
  discoverPowerShellStorePackageDirectories,
} from '../../electron/terminal/windowsShell'
import { parseWindowsTerminalDefaultProfile } from '../../electron/terminal/windowsTerminalProfile'
import { parseWindowsAppPathRegistryOutput } from '../../electron/terminal/windowsAppPath'

test('terminal polling defaults to and never exceeds the five-minute read limit', () => {
  assert.equal(clampTerminalPollingMs(undefined), MAX_TERMINAL_POLLING_MS)
  assert.equal(clampTerminalPollingMs(MAX_TERMINAL_POLLING_MS + 1), MAX_TERMINAL_POLLING_MS)
  assert.equal(clampTerminalPollingMs(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampTerminalPollingMs(-1), 0)
})

test('Windows terminal resolution uses the configured system command interpreter', () => {
  const environment = {
    ComSpec: 'C:/Windows/System32/cmd.exe',
    LOCALAPPDATA: 'C:/Users/test/AppData/Local',
    PATH: '',
    ProgramFiles: 'C:/Program Files',
  }
  const shell = resolveTerminalShellSpec({
    env: environment,
    isCommandAvailable: (command) => command === environment.ComSpec,
    platform: 'win32',
  })

  assert.equal(shell.label, 'Command Prompt')
  assert.equal(shell.command, environment.ComSpec)
  assert.deepEqual(shell.args, [])

  assert.throws(
    () => resolveTerminalShellSpec({
      env: { PATH: '' },
      isCommandAvailable: () => false,
      platform: 'win32',
    }),
    /could not find the Windows system shell/u,
  )
})

test('Windows terminal resolution supports the nested Microsoft Store execution alias', () => {
  const environment = {
    LOCALAPPDATA: 'C:/Users/test/AppData/Local',
    PATH: '',
    ProgramFiles: 'C:/Program Files',
  }
  const nestedAlias = 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\Microsoft.PowerShell_8wekyb3d8bbwe\\pwsh.exe'
  const shell = resolveTerminalShellSpec({
    env: environment,
    isCommandAvailable: (command) => command === nestedAlias,
    platform: 'win32',
  })

  assert.equal(shell.command, nestedAlias)
})

test('Windows shell fallbacks include versioned Store packages in newest-first order', () => {
  const candidates = createWindowsShellCandidates(
    {
      PATH: '',
      ProgramFiles: 'C:/Program Files',
    },
    {
      storePackageDirectories: [
        'Microsoft.PowerShell_7.4.2.0_x64__8wekyb3d8bbwe',
        'Microsoft.PowerShell_7.10.1.0_x64__8wekyb3d8bbwe',
        'Microsoft.PowerShell_7.9.3.0_x64__8wekyb3d8bbwe',
      ],
      windowsTerminalProfile: null,
    },
  )
  const storeCommands = candidates
    .filter(({ command }) => command.includes('Microsoft.PowerShell_7.'))
    .map(({ command }) => command)

  assert.match(storeCommands[0], /Microsoft\.PowerShell_7\.10\.1\.0_x64/u)
  assert.match(storeCommands[1], /Microsoft\.PowerShell_7\.9\.3\.0_x64/u)
})

test('Windows terminal resolution prefers the Windows Terminal default profile over ComSpec', () => {
  const profile = {
    args: ['-nologo'],
    command: 'pwsh.exe',
    label: 'PowerShell',
  }
  const candidates = createWindowsShellCandidates(
    { ComSpec: 'C:/Windows/System32/cmd.exe', PATH: '' },
    { windowsTerminalProfile: profile },
  )

  assert.equal(candidates[0].source, 'terminal-profile')
  assert.equal(candidates[0].command, 'pwsh.exe')
  assert.deepEqual(candidates[0].args, ['-nologo'])
  assert.equal(candidates[0].label, 'PowerShell')
})

test('PowerShell default profiles try absolute installations before falling back to ComSpec', () => {
  const profile = {
    args: ['-nologo'],
    command: 'pwsh.exe',
    label: 'PowerShell',
  }
  const environment = {
    ComSpec: 'C:/Windows/System32/cmd.exe',
    PATH: '',
    ProgramFiles: 'C:/Program Files',
  }
  const absolutePowerShell = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  const shell = createWindowsShellCandidates(environment, {
    windowsTerminalProfile: profile,
  }).find(({ command }) =>
    command === absolutePowerShell || command === environment.ComSpec)

  assert.equal(shell?.command, absolutePowerShell)
  assert.equal(shell?.label, 'PowerShell')
  assert.ok(shell?.args.includes('-nologo'))
})

test('Windows always prefers an installed PowerShell 7 over an available Command Prompt', () => {
  const environment = {
    ComSpec: 'C:/Windows/System32/cmd.exe',
    LOCALAPPDATA: 'C:/Users/test/AppData/Local',
    PATH: '',
    ProgramFiles: 'C:/Program Files',
  }
  const absolutePowerShell = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
  const candidates = createWindowsShellCandidates(environment, {
    windowsAppPathPowerShell: null,
    windowsTerminalProfile: null,
  })
  const resolution = candidates.find(({ command }) =>
    command === absolutePowerShell || command === environment.ComSpec)

  assert.equal(resolution?.command, absolutePowerShell)
  assert.equal(resolution?.label, 'PowerShell 7')
})

test('Windows App Paths resolves Store-installed PowerShell before Command Prompt', () => {
  const storePowerShell = 'C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.5.0_x64__8wekyb3d8bbwe\\pwsh.exe'
  const environment = {
    ComSpec: 'C:/Windows/System32/cmd.exe',
    PATH: '',
  }
  const candidates = createWindowsShellCandidates(environment, {
    windowsAppPathPowerShell: storePowerShell,
    windowsTerminalProfile: null,
  })
  const resolution = candidates.find(({ command }) =>
    command === storePowerShell || command === environment.ComSpec)

  assert.equal(resolution?.command, storePowerShell)
  assert.equal(resolution?.label, 'PowerShell 7')
})

test('Windows App Paths registry output extracts and expands the executable path', () => {
  const output = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pwsh.exe
    (Default)    REG_EXPAND_SZ    %ProgramFiles%\\PowerShell\\7\\pwsh.exe
  `

  assert.equal(
    parseWindowsAppPathRegistryOutput(output, { ProgramFiles: 'C:\\Program Files' }),
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  )
})

test('Windows Terminal settings resolve the selected profile command and arguments', () => {
  const profile = parseWindowsTerminalDefaultProfile(`{
    // Windows Terminal settings permit comments and trailing commas.
    "defaultProfile": "{power-shell}",
    "profiles": {
      "list": [
        {
          "guid": "{power-shell}",
          "name": "PowerShell",
          "commandline": "pwsh.exe -nologo",
        },
      ],
    },
  }`, {})

  assert.deepEqual(profile, {
    args: ['-nologo'],
    command: 'pwsh.exe',
    label: 'PowerShell',
  })
})

test('Windows Store discovery safely handles inaccessible directories', () => {
  assert.deepEqual(
    discoverPowerShellStorePackageDirectories('Z:/directory/that/does/not/exist'),
    [],
  )
})

test('Windows terminal resolution honors an explicit TideCode shell path first', () => {
  const configuredPath = 'D:/Portable/PowerShell/pwsh.exe'
  const shell = resolveTerminalShellSpec({
    env: {
      PATH: 'C:/unrelated',
      ComSpec: 'C:/Windows/System32/cmd.exe',
      TIDECODE_TERMINAL_SHELL: configuredPath,
    },
    isCommandAvailable: (command) => command === configuredPath,
    platform: 'win32',
  })

  assert.equal(shell.command, configuredPath)
  assert.equal(shell.label, 'PowerShell 7')
})

test('macOS and Linux prefer the configured account login shell', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const shell = resolveTerminalShellSpec({
      env: { SHELL: '/custom/bin/zsh' },
      isCommandAvailable: (command) => command === '/custom/bin/zsh',
      platform,
    })
    assert.equal(shell.command, '/custom/bin/zsh')
    assert.equal(shell.label, 'zsh')
    assert.deepEqual(shell.args, ['-l'])

  }
})

test('macOS and Linux use native fallback shells when GUI environments omit SHELL', () => {
  const macShell = resolveTerminalShellSpec({
    env: {},
    isCommandAvailable: (command) => command === '/bin/zsh',
    platform: 'darwin',
  })
  const linuxShell = resolveTerminalShellSpec({
    env: {},
    isCommandAvailable: (command) => command === '/bin/sh',
    platform: 'linux',
  })

  assert.equal(macShell.command, '/bin/zsh')
  assert.equal(linuxShell.command, '/bin/sh')
  assert.throws(
    () => resolveTerminalShellSpec({
      env: {},
      isCommandAvailable: () => false,
      platform: 'linux',
    }),
    /could not find an interactive system shell/u,
  )
})
