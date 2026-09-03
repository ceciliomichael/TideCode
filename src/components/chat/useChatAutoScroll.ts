import { useLayoutEffect, type RefObject } from 'react'
import type { Message } from '../../types/chat'
import { useScrollFollower } from './useScrollFollower'

const REVERT_ANCHOR_TOP_PADDING_PX = 24

interface MessageAnchorScrollInput {
  clientHeight: number
  currentScrollTop: number
  messageTop: number
  scrollHeight: number
  viewportTop: number
}

export function resolveMessageAnchorScrollTop({
  clientHeight,
  currentScrollTop,
  messageTop,
  scrollHeight,
  viewportTop,
}: MessageAnchorScrollInput): number {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  const desiredScrollTop = currentScrollTop + messageTop - viewportTop - REVERT_ANCHOR_TOP_PADDING_PX
  return Math.min(maxScrollTop, Math.max(0, desiredScrollTop))
}

interface UseChatAutoScrollOptions {
  conversationId: string | null
  followLatestSignal?: number
  messages: readonly Message[]
  resetAnchorMessageId?: string | null
  scrollContainerRef: RefObject<HTMLDivElement>
}

export function useChatAutoScroll({
  conversationId,
  followLatestSignal = 0,
  messages,
  resetAnchorMessageId = null,
  scrollContainerRef,
}: UseChatAutoScrollOptions): void {
  const latestUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id ?? 'no-user-message'
  const resetSignal = `${conversationId ?? 'no-conversation'}:${latestUserMessageId}:${followLatestSignal}`
  const resetAnchorMessagePresent = resetAnchorMessageId !== null && messages.some((message) => message.id === resetAnchorMessageId)

  const { pauseFollowingLatest } = useScrollFollower({
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

  useLayoutEffect(() => {
    if (!conversationId || !resetAnchorMessageId || !resetAnchorMessagePresent) {
      return
    }

    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const targetMessage = Array.from(container.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (element) => element.dataset.messageId === resetAnchorMessageId,
    )
    if (!targetMessage) {
      return
    }

    pauseFollowingLatest()

    const containerRect = container.getBoundingClientRect()
    const targetRect = targetMessage.getBoundingClientRect()
    container.scrollTop = resolveMessageAnchorScrollTop({
      clientHeight: container.clientHeight,
      currentScrollTop: container.scrollTop,
      messageTop: targetRect.top,
      scrollHeight: container.scrollHeight,
      viewportTop: containerRect.top,
    })
  }, [
    conversationId,
    pauseFollowingLatest,
    resetAnchorMessageId,
    resetAnchorMessagePresent,
    scrollContainerRef,
  ])
}
