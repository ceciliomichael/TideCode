import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '..')
const installerSource = readFileSync(resolve(workspaceRoot, 'installer/installer.nsh'), 'utf8')
const backslash = String.fromCharCode(92)

const normalizePathEntryForComparison = (value: string): string => {
  const withoutTrailingSlash = value.endsWith(backslash) ? value.slice(0, -1) : value
  return withoutTrailingSlash.toLowerCase()
}

const pathContainsEntry = (pathValue: string, candidate: string): boolean => {
  const normalizedCandidate = normalizePathEntryForComparison(candidate)
  return pathValue
    .split(';')
    .some((entry) => normalizePathEntryForComparison(entry) === normalizedCandidate)
}

test('Windows installer PATH registration scans exact entries before appending', () => {
  const machineEnvironmentKey = [
    'SYSTEM',
    'CurrentControlSet',
    'Control',
    'Session Manager',
    'Environment',
  ].join(backslash)

  assert.equal(installerSource.includes('!macro addTideCodeBinToPath ROOT REGKEY'), true)
  assert.equal(installerSource.includes('StrCmp $3 $1 tidecode_path_done_'), true)
  assert.equal(
    installerSource.includes(`StrCmp $6 "${backslash}" 0 tidecode_path_compare_ready_`),
    true,
  )
  assert.equal(
    installerSource.includes(
      `!insertmacro addTideCodeBinToPath HKLM "${machineEnvironmentKey}"`,
    ),
    true,
  )
  assert.equal(installerSource.includes('!insertmacro addTideCodeBinToPath HKCU "Environment"'), true)
  assert.equal(
    installerSource.includes(`$0;$INSTDIR${backslash}resources${backslash}bin`),
    false,
  )
})

test('Windows PATH comparison contract recognizes repeated TideCode entries', () => {
  const tideCodeBin = [
    'C:',
    'Users',
    'Admin',
    'AppData',
    'Local',
    'Programs',
    'TideCode',
    'resources',
    'bin',
  ].join(backslash)
  const system32 = ['C:', 'Windows', 'System32'].join(backslash)
  const tools = ['C:', 'Tools'].join(backslash)

  assert.equal(pathContainsEntry('', tideCodeBin), false)
  assert.equal(pathContainsEntry(`${system32};${tools}`, tideCodeBin), false)
  assert.equal(pathContainsEntry(`${system32};${tideCodeBin}`, tideCodeBin), true)
  assert.equal(pathContainsEntry(`${system32};${tideCodeBin}${backslash}`, tideCodeBin), true)
  assert.equal(pathContainsEntry(`${system32};${tideCodeBin.toUpperCase()}`, tideCodeBin), true)
  assert.equal(pathContainsEntry(`${system32};${tideCodeBin}2`, tideCodeBin), false)
})
