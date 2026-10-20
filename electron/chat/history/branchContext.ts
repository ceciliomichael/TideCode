import type { Message } from '../../../src/types/chat'
import type { CanonicalHistoryDocument, CanonicalHistoryEvent } from './contracts'
import { sha256, stableStringify } from '../cache/canonicalization'

/** Events on the current ancestry, bounded at every fork, never sibling work. */
export function getBranchHistoryEvents(document: CanonicalHistoryDocument): CanonicalHistoryEvent[] {
  const selected = new Set<CanonicalHistoryEvent>()
  const visited = new Set<string>()
  let branchId = document.activeBranchId
  let revisionLimit = Infinity
  let retainedIds: Set<string> | null = null

  while (!visited.has(branchId)) {
    visited.add(branchId)
    const branchEvents = document.events.filter((event) => event.branchId === branchId)
    const events = branchEvents.filter((event) => event.revision <= revisionLimit)
    for (const event of events) {
      if (
        retainedIds && 'anchorUserMessageId' in event &&
        event.anchorUserMessageId !== null && !retainedIds.has(event.anchorUserMessageId)
      ) {
        continue
      }
      selected.add(event)
    }
    const fork = branchEvents.find((event) => event.type === 'branch_created')
    if (!fork || fork.type !== 'branch_created') {
      break
    }
    const synchronized = document.events.find((event) => (
      event.branchId === branchId && event.revision > fork.revision && event.type === 'messages_synchronized'
    ))
    if (!synchronized && fork.retainedThroughRevision === undefined) {
      break
    }
    if (synchronized?.type === 'messages_synchronized') {
      const ids = new Set(synchronized.messageIds)
      // Existing edit branches were synchronized through the edited user turn.
      // Its old anchor is unsafe; snapshots from earlier turns still apply.
      if (fork.retainedThroughRevision === undefined && fork.reason === 'edited') {
        const editedAnchor = synchronized.messageIds.at(-1)
        if (editedAnchor) {
          ids.delete(editedAnchor)
        }
      }
      if (retainedIds === null) {
        retainedIds = ids
      } else {
        for (const id of retainedIds) {
          if (!ids.has(id)) {
            retainedIds.delete(id)
          }
        }
      }
    }
    revisionLimit = Math.min(revisionLimit, fork.retainedThroughRevision ?? fork.revision - 1)
    branchId = fork.fromBranchId
  }
  return document.events.filter((event) => selected.has(event))
}

/** Find the canonical boundary before the first removed or changed display message. */
export function getHistoryCutoffRevision(
  document: CanonicalHistoryDocument,
  retainedMessages: readonly Message[],
  sourceMessages?: readonly Message[],
) {
  let retainedCount = 0
  if (sourceMessages) {
    while (
      retainedCount < retainedMessages.length && retainedCount < sourceMessages.length &&
      stableStringify(retainedMessages[retainedCount]) === stableStringify(sourceMessages[retainedCount])
    ) {
      retainedCount += 1
    }
    if (retainedCount === sourceMessages.length) {
      return document.revision
    }
  } else {
    while (
      retainedCount < retainedMessages.length &&
      retainedMessages[retainedCount].id === document.synchronizedMessageIds[retainedCount] &&
      sha256(stableStringify(retainedMessages[retainedCount])) === document.synchronizedMessageDigests[retainedCount]
    ) {
      retainedCount += 1
    }
  }

  const cutoffAt = sourceMessages?.[retainedCount]?.timestamp ??
    retainedMessages[retainedCount]?.timestamp ?? retainedMessages.at(-1)?.timestamp ?? 0
  const retainedIds = new Set(retainedMessages.slice(0, retainedCount).map((message) => message.id))
  let revision = 0
  for (const event of getBranchHistoryEvents(document)) {
    if (event.createdAt >= cutoffAt) {
      continue
    }
    if ('anchorUserMessageId' in event && event.anchorUserMessageId !== null && !retainedIds.has(event.anchorUserMessageId)) {
      continue
    }
    revision = Math.max(revision, event.revision)
  }
  return revision
}
