import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advanceFolderPickerNavigation,
  areFolderPickerPathsEqual,
  filterFolderPickerEntries,
  findActiveFolderPickerRootPath,
  getFolderPickerSuggestions,
  resolveFolderPickerInputPath,
} from '../src/components/sidebar/remoteFolderPickerState'

test('folder picker navigation truncates forward history when navigating elsewhere', () => {
  const state = {
    history: ['C:\\', 'C:\\Users', 'C:\\Users\\Admin'],
    index: 1,
  }

  assert.deepEqual(advanceFolderPickerNavigation(state, 'D:\\Projects'), {
    history: ['C:\\', 'C:\\Users', 'D:\\Projects'],
    index: 2,
  })
})

test('folder picker navigation ignores navigation to the current path', () => {
  const state = {
    history: ['C:\\', 'C:\\Users'],
    index: 1,
  }

  assert.equal(advanceFolderPickerNavigation(state, 'C:\\Users'), state)
})

test('folder picker path equality tolerates slash and case differences', () => {
  assert.equal(
    areFolderPickerPathsEqual('C:\\Users\\Admin\\Desktop\\', 'c:/users/admin/desktop'),
    true,
  )
  assert.equal(
    areFolderPickerPathsEqual('C:\\Users\\Admin\\Desktop', 'C:\\Users\\Admin\\Documents'),
    false,
  )
})

test('folder picker search filters folder names case-insensitively', () => {
  const entries = [
    { name: 'Downloads', path: 'C:\\Users\\Admin\\Downloads' },
    { name: 'Projects', path: 'C:\\Users\\Admin\\Projects' },
  ]

  assert.deepEqual(
    filterFolderPickerEntries(entries, 'DOWN').map((entry) => entry.name),
    ['Downloads'],
  )
  assert.deepEqual(filterFolderPickerEntries(entries, ''), entries)
})

test('folder picker input suggestions stay within the current directory and tolerate near spelling', () => {
  const entries = [
    { name: 'Documents', path: 'C:\\Users\\Admin\\Documents' },
    { name: 'Projects', path: 'C:\\Users\\Admin\\Projects' },
    { name: 'Pictures', path: 'C:\\Users\\Admin\\Pictures' },
  ]

  assert.deepEqual(
    getFolderPickerSuggestions(entries, 'projcts').map((entry) => entry.name),
    ['Projects'],
  )
  assert.deepEqual(
    getFolderPickerSuggestions(entries, 'doc').map((entry) => entry.name),
    ['Documents'],
  )
})

test('folder picker input resolves only the current directory or an immediate child by name', () => {
  const entries = [
    { name: 'Projects', path: 'C:\\Users\\Admin\\Projects' },
  ]

  assert.equal(
    resolveFolderPickerInputPath(entries, 'Admin', 'C:\\Users\\Admin', 'admin'),
    'C:\\Users\\Admin',
  )
  assert.equal(
    resolveFolderPickerInputPath(entries, 'Admin', 'C:\\Users\\Admin', 'projects'),
    'C:\\Users\\Admin\\Projects',
  )
  assert.equal(
    resolveFolderPickerInputPath(entries, 'Admin', 'C:\\Users\\Admin', 'nested'),
    null,
  )
})

test('folder picker keeps the most specific quick access or drive root active', () => {
  const roots = [
    { kind: 'drive' as const, label: 'C: Local Disk', path: 'C:\\' },
    { kind: 'home' as const, label: 'Home', path: 'C:\\Users\\Admin' },
    { kind: 'desktop' as const, label: 'Desktop', path: 'C:\\Users\\Admin\\Desktop' },
  ]

  assert.equal(
    findActiveFolderPickerRootPath(roots, 'C:\\Users\\Admin\\Desktop\\Project'),
    'C:\\Users\\Admin\\Desktop',
  )
  assert.equal(
    findActiveFolderPickerRootPath(roots, 'C:\\Users\\Admin\\Code'),
    'C:\\Users\\Admin',
  )
  assert.equal(
    findActiveFolderPickerRootPath(roots, 'C:\\Windows'),
    'C:\\',
  )
})
