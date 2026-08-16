import type { ChatMode, ConversationRecord, Message } from '../../src/types/chat'
import { replaceStoredMessages } from '../history/store'

const STREAM_PROGRESS_PERSIST_DEBOUNCE_MS = 600
const STREAM_PROGRESS_PERSIST_CHAR_FLUSH_THRESHOLD = 768

export interface SharedStreamPersistenceOptions {
  conversationId: string
  chatMode: ChatMode
  onPersisted?: (conversation: ConversationRecord) => void
  onError?: (error: unknown) => void
}

export class SharedStreamPersistence {
  private pendingMessages: Message[] | null = null
  private pendingFlushTimeout: ReturnType<typeof setTimeout> | null = null
  private flushPromise: Promise<ConversationRecord | null> | null = null
  private pendingDeltaCharCount = 0

  constructor(private readonly options: SharedStreamPersistenceOptions) {}

  queue(
    messages: Message[],
    options?: { immediate?: boolean },
    hint?: { deltaCharCount?: number },
  ) {
    this.pendingMessages = [...messages]

    if (typeof hint?.deltaCharCount === 'number' && hint.deltaCharCount > 0) {
      this.pendingDeltaCharCount += hint.deltaCharCount
    }

    if (options?.immediate || this.pendingDeltaCharCount >= STREAM_PROGRESS_PERSIST_CHAR_FLUSH_THRESHOLD) {
      this.pendingDeltaCharCount = 0
      if (this.pendingFlushTimeout) {
        clearTimeout(this.pendingFlushTimeout)
        this.pendingFlushTimeout = null
      }
      void this.flushPending()
      return
    }

    if (this.pendingFlushTimeout) return
    this.pendingFlushTimeout = setTimeout(() => {
      this.pendingFlushTimeout = null
      this.pendingDeltaCharCount = 0
      void this.flushPending()
    }, STREAM_PROGRESS_PERSIST_DEBOUNCE_MS)
  }

  async flush() {
    if (this.pendingFlushTimeout) {
      clearTimeout(this.pendingFlushTimeout)
      this.pendingFlushTimeout = null
    }
    this.pendingDeltaCharCount = 0
    return this.flushPending()
  }

  private flushPending() {
    if (this.flushPromise) return this.flushPromise

    this.flushPromise = (async () => {
      let latest: ConversationRecord | null = null
      while (this.pendingMessages) {
        const messages = this.pendingMessages
        this.pendingMessages = null
        latest = await replaceStoredMessages({
          chatMode: this.options.chatMode,
          conversationId: this.options.conversationId,
          messages,
        })
        this.options.onPersisted?.(latest)
      }
      return latest
    })()
      .catch((error) => {
        this.options.onError?.(error)
        return null
      })
      .finally(() => {
        this.flushPromise = null
      })

    return this.flushPromise
  }
}
