import assert from 'node:assert/strict'
import test from 'node:test'
import { getSourceControlPrimaryAction } from '../src/components/sourceControl/sourceControlPrimaryAction'

test('source control keeps Commit as the primary action while files are changed', () => {
  assert.equal(
    getSourceControlPrimaryAction({
      aheadCommitCount: 0,
      behindCommitCount: 0,
      hasRemote: false,
      stagedFileCount: 1,
      unstagedFileCount: 0,
    }),
    'commit',
  )
  assert.equal(
    getSourceControlPrimaryAction({
      aheadCommitCount: 0,
      behindCommitCount: 0,
      hasRemote: true,
      stagedFileCount: 0,
      unstagedFileCount: 2,
    }),
    'commit',
  )
})
test('source control switches to Publish to GitHub when a local repository is clean and has no remote', () => {
  assert.equal(
    getSourceControlPrimaryAction({
      aheadCommitCount: 0,
      behindCommitCount: 0,
      hasRemote: false,
      stagedFileCount: 0,
      unstagedFileCount: 0,
    }),
    'publish-to-github',
  )
})

test('source control keeps Sync Changes for clean repositories with outgoing commits', () => {
  assert.equal(
    getSourceControlPrimaryAction({
      aheadCommitCount: 1,
      behindCommitCount: 0,
      hasRemote: true,
      stagedFileCount: 0,
      unstagedFileCount: 0,
    }),
    'sync-changes',
  )
})

test('source control offers sync when there are incoming commits but no local changes', () => {
  assert.equal(getSourceControlPrimaryAction({
    aheadCommitCount: 0,
    behindCommitCount: 2,
    hasRemote: true,
    stagedFileCount: 0,
    unstagedFileCount: 0,
  }), 'sync-changes')
})
