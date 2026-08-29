import type { QueuedMessage } from '../../../src/types/chat'

export interface PendingSteerMessageSnapshot {
  messages: readonly QueuedMessage[]
  revision: number
}

function cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
  return {
    ...message,
    attachments: Array.isArray(message.attachments)
      ? message.attachments.map((attachment) => ({ ...attachment }))
      : undefined,
    mentionPathMap: message.mentionPathMap ? { ...message.mentionPathMap } : undefined,
  }
}

function normalizePendingMessages(messages: readonly QueuedMessage[]) {
  const seenMessageIds = new Set<string>()
  const normalizedMessages: QueuedMessage[] = []

  for (const message of messages) {
    if (
      typeof message !== 'object' ||
      message === null ||
      typeof message.id !== 'string' ||
      typeof message.content !== 'string' ||
      typeof message.timestamp !== 'number' ||
      !Number.isFinite(message.timestamp)
    ) {
      continue
    }

    const id = message.id.trim()
    const content = message.content.trim()
    if (!id || seenMessageIds.has(id) || (!content && !message.attachments?.length)) {
      continue
    }

    seenMessageIds.add(id)
    normalizedMessages.push(cloneQueuedMessage({
      ...message,
      content,
      id,
    }))
  }

  return normalizedMessages
}

/**
 * Holds renderer-authored steer messages for one live model stream.
 * Revisions make edits/removals idempotent, while consumed ids prevent a
 * delayed renderer snapshot from re-inserting a message already delivered at
 * a tool boundary.
 */
export class ChatStreamSteeringController {
  private readonly consumedMessageIds = new Set<string>()
  private latestRevision = -1
  private pendingMessages: QueuedMessage[] = []

  replacePending(snapshot: PendingSteerMessageSnapshot) {
    if (
      typeof snapshot !== 'object' ||
      snapshot === null ||
      !Array.isArray(snapshot.messages) ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0
    ) {
      return false
    }
    if (snapshot.revision <= this.latestRevision) {
      return true
    }

    this.latestRevision = snapshot.revision
    this.pendingMessages = normalizePendingMessages(snapshot.messages)
      .filter((message) => !this.consumedMessageIds.has(message.id))
    return true
  }

  consumePendingAtToolBoundary() {
    const messages = this.pendingMessages.map(cloneQueuedMessage)
    this.pendingMessages = []
    for (const message of messages) {
      this.consumedMessageIds.add(message.id)
    }
    return messages
  }
}
