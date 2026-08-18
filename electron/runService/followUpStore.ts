import type {
  ClaimSharedFollowUpsResult,
  SharedFollowUpItem,
  SharedFollowUpMutation,
  SharedFollowUpSnapshot,
} from '../../src/types/chat'

function cloneItem(item: SharedFollowUpItem): SharedFollowUpItem {
  return {
    behavior: item.behavior,
    message: {
      ...item.message,
      ...(item.message.attachments ? { attachments: [...item.message.attachments] } : {}),
    },
  }
}

function cloneSnapshot(snapshot: SharedFollowUpSnapshot): SharedFollowUpSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map(cloneItem),
  }
}

function applyMutation(items: readonly SharedFollowUpItem[], mutation: SharedFollowUpMutation) {
  if (mutation.type === 'add') {
    if (items.some((item) => item.message.id === mutation.item.message.id)) return [...items]
    return [...items, cloneItem(mutation.item)]
  }

  if (mutation.type === 'update') {
    return items.map((item) =>
      item.message.id === mutation.message.id
        ? cloneItem({ ...item, message: mutation.message })
        : item,
    )
  }

  if (mutation.type === 'remove') {
    return items.filter((item) => item.message.id !== mutation.id)
  }

  if (mutation.sourceId === mutation.targetId) return [...items]
  const sourceIndex = items.findIndex((item) => item.message.id === mutation.sourceId)
  const targetIndex = items.findIndex((item) => item.message.id === mutation.targetId)
  if (sourceIndex < 0 || targetIndex < 0) return [...items]

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(sourceIndex, 1)
  if (!movedItem) return nextItems
  const nextTargetIndex = nextItems.findIndex((item) => item.message.id === mutation.targetId)
  const insertionIndex = sourceIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex
  nextItems.splice(Math.max(0, insertionIndex), 0, movedItem)
  return nextItems
}

export class SharedFollowUpStore {
  private readonly snapshotsByStreamId = new Map<string, SharedFollowUpSnapshot>()

  register(runId: string, streamId: string, conversationId: string) {
    const snapshot: SharedFollowUpSnapshot = {
      conversationId,
      items: [],
      revision: 0,
      runId,
      streamId,
    }
    this.snapshotsByStreamId.set(streamId, snapshot)
    return cloneSnapshot(snapshot)
  }

  get(streamId: string) {
    const snapshot = this.snapshotsByStreamId.get(streamId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  update(streamId: string, mutation: SharedFollowUpMutation) {
    const current = this.snapshotsByStreamId.get(streamId)
    if (!current) throw new Error('Unable to find shared follow-up state for this stream.')
    const next: SharedFollowUpSnapshot = {
      ...current,
      items: applyMutation(current.items, mutation),
      revision: current.revision + 1,
    }
    this.snapshotsByStreamId.set(streamId, next)
    return cloneSnapshot(next)
  }

  consume(streamId: string, messageIds: readonly string[]) {
    const current = this.snapshotsByStreamId.get(streamId)
    if (!current || messageIds.length === 0) return current ? cloneSnapshot(current) : null
    const consumedIds = new Set(messageIds)
    const items = current.items.filter((item) => !consumedIds.has(item.message.id))
    if (items.length === current.items.length) return cloneSnapshot(current)
    const next: SharedFollowUpSnapshot = { ...current, items, revision: current.revision + 1 }
    this.snapshotsByStreamId.set(streamId, next)
    return cloneSnapshot(next)
  }

  claim(streamId: string): ClaimSharedFollowUpsResult {
    const current = this.snapshotsByStreamId.get(streamId)
    if (!current || current.items.length === 0) return { messages: [] }
    const messages = current.items.map((item) => cloneItem(item).message)
    this.snapshotsByStreamId.set(streamId, { ...current, items: [], revision: current.revision + 1 })
    return { messages }
  }

  remove(streamId: string) {
    this.snapshotsByStreamId.delete(streamId)
  }
}
