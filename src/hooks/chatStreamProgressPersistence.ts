import type { ConversationRecord, Message } from '../types/chat'

const STREAM_PROGRESS_PERSIST_DEBOUNCE_MS = 600
const STREAM_PROGRESS_PERSIST_CHAR_FLUSH_THRESHOLD = 768

export interface ChatStreamProgressPersistenceInput {
  conversationId: string
  persistSnapshot: (conversationId: string, messages: Message[]) => Promise<ConversationRecord>
  setError: (errorMessage: string | null) => void
  shouldDiscard?: () => boolean
}

export interface ChatStreamProgressPersistenceController {
  discard: () => Promise<void>
  flush: () => Promise<ConversationRecord | null>
  queueSnapshot: (
    messages: Message[],
    options?: { immediate?: boolean },
    hint?: { deltaCharCount?: number },
  ) => void
}

function toErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage
}

export function createChatStreamProgressPersistenceController(
  input: ChatStreamProgressPersistenceInput,
): ChatStreamProgressPersistenceController {
  let pendingMessages: Message[] | null = null
  let pendingFlushTimeoutId: ReturnType<typeof setTimeout> | null = null
  let flushPromise: Promise<ConversationRecord | null> | null = null
  let pendingDeltaCharCount = 0
  let isDiscarded = false

  const shouldDiscardPendingWrites = () => {
    if (isDiscarded) {
      return true
    }

    try {
      return input.shouldDiscard?.() === true
    } catch (error) {
      console.error('Unable to determine whether stream history persistence should be discarded.', error)
      return false
    }
  }

  const flushPendingMessages = () => {
    if (flushPromise) {
      return flushPromise
    }

    flushPromise = (async () => {
      let latestSavedConversation: ConversationRecord | null = null

      while (pendingMessages !== null) {
        if (shouldDiscardPendingWrites()) {
          pendingMessages = null
          break
        }

        const messagesSnapshot = pendingMessages
        pendingMessages = null
        latestSavedConversation = await input.persistSnapshot(input.conversationId, messagesSnapshot)
      }

      return latestSavedConversation
    })()
      .catch((caughtError) => {
        console.error(caughtError)
        if (!isDiscarded) {
          input.setError(toErrorMessage(caughtError, 'Unable to save the latest assistant progress.'))
        }
        return null
      })
      .finally(() => {
        flushPromise = null
      })

    return flushPromise
  }

  const queueSnapshot = (messages: Message[], options?: { immediate?: boolean }) => {
    if (shouldDiscardPendingWrites()) {
      return
    }

    pendingMessages = [...messages]
    pendingDeltaCharCount = options?.immediate ? 0 : pendingDeltaCharCount

    if (options?.immediate) {
      if (pendingFlushTimeoutId !== null) {
        clearTimeout(pendingFlushTimeoutId)
        pendingFlushTimeoutId = null
      }

      void flushPendingMessages()
      return
    }

    if (pendingFlushTimeoutId !== null) {
      return
    }

    pendingFlushTimeoutId = setTimeout(() => {
      pendingFlushTimeoutId = null
      void flushPendingMessages()
    }, STREAM_PROGRESS_PERSIST_DEBOUNCE_MS)
  }

  const queueSnapshotWithHint = (
    messages: Message[],
    options?: { immediate?: boolean },
    hint?: { deltaCharCount?: number },
  ) => {
    if (typeof hint?.deltaCharCount === 'number' && Number.isFinite(hint.deltaCharCount) && hint.deltaCharCount > 0) {
      pendingDeltaCharCount += hint.deltaCharCount
      if (pendingDeltaCharCount >= STREAM_PROGRESS_PERSIST_CHAR_FLUSH_THRESHOLD) {
        queueSnapshot(messages, { immediate: true })
        pendingDeltaCharCount = 0
        return
      }
    }

    queueSnapshot(messages, options)
  }

  const flush = async () => {
    if (pendingFlushTimeoutId !== null) {
      clearTimeout(pendingFlushTimeoutId)
      pendingFlushTimeoutId = null
    }

    pendingDeltaCharCount = 0
    return flushPendingMessages()
  }

  const discard = async () => {
    isDiscarded = true

    if (pendingFlushTimeoutId !== null) {
      clearTimeout(pendingFlushTimeoutId)
      pendingFlushTimeoutId = null
    }

    pendingMessages = null
    pendingDeltaCharCount = 0

    if (flushPromise) {
      await flushPromise
    }
  }

  return {
    discard,
    flush,
    queueSnapshot: queueSnapshotWithHint,
  }
}
