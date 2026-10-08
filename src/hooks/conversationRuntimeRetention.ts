import type { ConversationRecord } from '../types/chat'

interface RetainedRuntime {
  conversation: ConversationRecord
  isSending: boolean
  activeStreamId: string | null
}

const estimatedBytes = new WeakMap<ConversationRecord, number>()

function estimateConversationBytes(conversation: ConversationRecord) {
  const cached = estimatedBytes.get(conversation)
  if (cached !== undefined) {
    return cached
  }
  let bytes = 0
  const pending: unknown[] = [conversation]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value === 'string') {
      bytes += value.length * 2
    } else if (value && typeof value === 'object' && !visited.has(value)) {
      visited.add(value)
      for (const child of Object.values(value)) {
        pending.push(child)
      }
    }
  }
  estimatedBytes.set(conversation, bytes)
  return bytes
}

export function retainConversationRuntimes<T extends RetainedRuntime>(
  states: Record<string, T>,
  selectedId: string | null,
  runningIds: ReadonlySet<string>,
  lastUsed: ReadonlyMap<string, number>,
): Record<string, T> {
  const inactive = Object.entries(states).filter(([id, state]) =>
    id !== selectedId && !runningIds.has(id) && !state.isSending && !state.activeStreamId,
  ).sort(([left], [right]) => (lastUsed.get(right) ?? 0) - (lastUsed.get(left) ?? 0))
  let retainedBytes = 0
  let retainedCount = 0
  let nextStates = states
  for (const [id, state] of inactive) {
    const bytes = estimateConversationBytes(state.conversation)
    if (retainedCount < 3 && retainedBytes + bytes <= 16 * 1024 * 1024) {
      retainedCount += 1
      retainedBytes += bytes
      continue
    }
    if (nextStates === states) {
      nextStates = { ...states }
    }
    delete nextStates[id]
  }
  return nextStates
}
