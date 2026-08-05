const mutationQueues = new Map<string, Promise<void>>()

/**
 * Serializes read-modify-write operations for one conversation inside the
 * Electron process. The legacy conversation file is shared by streaming
 * progress persistence, rollback, and normal message appends; allowing those
 * operations to overlap can lose a newer snapshot or make Windows reject the
 * backup rename with EBUSY.
 */
export async function runConversationMutation<T>(
  conversationId: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const normalizedConversationId = conversationId.trim()
  if (normalizedConversationId.length === 0) {
    throw new Error('Conversation id is required for a history mutation.')
  }

  const previous = mutationQueues.get(normalizedConversationId) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  mutationQueues.set(normalizedConversationId, queued)

  await previous
  try {
    return await mutation()
  } finally {
    release()
    if (mutationQueues.get(normalizedConversationId) === queued) {
      mutationQueues.delete(normalizedConversationId)
    }
  }
}
