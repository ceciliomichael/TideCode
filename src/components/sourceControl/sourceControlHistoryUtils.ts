import type { GitHistoryEntry } from '../../types/chat'

export function prependCommittedHistoryEntry(
  currentEntries: readonly GitHistoryEntry[],
  nextEntry: GitHistoryEntry,
) {
  const retainedEntries = currentEntries
    .filter((entry) => entry.hash !== nextEntry.hash)
    .map((entry) => (entry.isHead ? { ...entry, isHead: false } : entry))

  return [nextEntry, ...retainedEntries]
}
