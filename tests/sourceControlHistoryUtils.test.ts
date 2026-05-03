import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitHistoryEntry } from '../src/types/chat'
import { prependCommittedHistoryEntry } from '../src/components/sourceControl/sourceControlHistoryUtils'

function buildHistoryEntry(input: Partial<GitHistoryEntry> & Pick<GitHistoryEntry, 'hash' | 'shortHash' | 'subject'>): GitHistoryEntry {
  return {
    authorName: 'A User',
    authoredAt: '2026-05-03T00:00:00+00:00',
    authoredRelativeTime: 'just now',
    graphPrefix: '',
    hash: input.hash,
    isHead: input.isHead ?? false,
    parentIds: input.parentIds ?? [],
    refs: input.refs ?? [],
    shortHash: input.shortHash,
    subject: input.subject,
  }
}

test('prependCommittedHistoryEntry prepends the new commit and clears the previous head flag', () => {
  const previousHead = buildHistoryEntry({
    hash: 'old-head',
    isHead: true,
    shortHash: 'oldhead',
    subject: 'fix: old work',
  })
  const olderCommit = buildHistoryEntry({
    hash: 'older',
    shortHash: 'older',
    subject: 'chore: older work',
  })
  const nextHead = buildHistoryEntry({
    hash: 'new-head',
    isHead: true,
    shortHash: 'newhead',
    subject: 'feat: new work',
  })

  const nextEntries = prependCommittedHistoryEntry([previousHead, olderCommit], nextHead)

  assert.deepEqual(nextEntries.map((entry) => entry.hash), ['new-head', 'old-head', 'older'])
  assert.equal(nextEntries[0]?.isHead, true)
  assert.equal(nextEntries[1]?.isHead, false)
  assert.equal(nextEntries[2]?.isHead, false)
})

test('prependCommittedHistoryEntry removes duplicate hashes from the list', () => {
  const existingEntry = buildHistoryEntry({
    hash: 'new-head',
    shortHash: 'newhead',
    subject: 'feat: new work',
  })
  const nextHead = buildHistoryEntry({
    hash: 'new-head',
    isHead: true,
    shortHash: 'newhead',
    subject: 'feat: new work',
  })

  const nextEntries = prependCommittedHistoryEntry([existingEntry], nextHead)

  assert.deepEqual(nextEntries.map((entry) => entry.hash), ['new-head'])
})
