import { type RefObject } from 'react'
import type { Message } from '../../types/chat'
import { useScrollFollower } from './useScrollFollower'

interface UseChatAutoScrollOptions {
  conversationId: string | null
  followLatestSignal?: number
  messages: readonly Message[]
  scrollContainerRef: RefObject<HTMLDivElement>
}

export function useChatAutoScroll({
  conversationId,
  followLatestSignal = 0,
  messages,
  scrollContainerRef,
}: UseChatAutoScrollOptions): void {
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id ?? 'no-user-message'
  const resetSignal = `${conversationId ?? 'no-conversation'}:${latestUserMessageId}:${followLatestSignal}`

  useScrollFollower({
    anchorOnReset: true,
    contentRevision: messages,
    // Transcript following is a viewport preference, not a transport state.
    // Provider lifecycle flags can briefly clear while reasoning closes, draft
    // messages rotate, or a completed stream is persisted. Keeping the follower
    // enabled across those transitions prevents the newest content from being
    // stranded below the composer. Explicit upward user intent still pauses it.
    isAutoFollowEnabled: true,
    resetSignal,
    scrollContainerRef,
  })
}
