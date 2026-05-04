import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { Message } from '../../types/chat'

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24
const AUTO_SCROLL_RESET_DELAY_MS = 50

function getNumUserMessages(messages: readonly Message[]): number {
  return messages.reduce((count, message) => count + (message.role === 'user' ? 1 : 0), 0)
}

function isAtBottom(container: HTMLDivElement): boolean {
  return Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < AUTO_SCROLL_BOTTOM_THRESHOLD_PX
}

interface UseChatAutoScrollOptions {
  conversationId: string | null
  messages: readonly Message[]
  scrollContainerRef: RefObject<HTMLDivElement>
  shouldAutoScroll: boolean
}

export function useChatAutoScroll({
  conversationId,
  messages,
  scrollContainerRef,
  shouldAutoScroll,
}: UseChatAutoScrollOptions): void {
  const userHasScrolledRef = useRef(false)
  const isAutoScrollingRef = useRef(false)
  const autoScrollResetTimeoutRef = useRef<number | null>(null)
  const shouldAnchorToLatestMessageRef = useRef(false)
  const numUserMessages = useMemo(() => getNumUserMessages(messages), [messages])

  const clearAutoScrollResetTimeout = useCallback(() => {
    if (autoScrollResetTimeoutRef.current !== null) {
      window.clearTimeout(autoScrollResetTimeoutRef.current)
      autoScrollResetTimeoutRef.current = null
    }
  }, [])

  const finishProgrammaticScroll = useCallback(() => {
    isAutoScrollingRef.current = true
    clearAutoScrollResetTimeout()
    autoScrollResetTimeoutRef.current = window.setTimeout(() => {
      isAutoScrollingRef.current = false
      autoScrollResetTimeoutRef.current = null
    }, AUTO_SCROLL_RESET_DELAY_MS)
  }, [clearAutoScrollResetTimeout])

  const scrollToBottom = useCallback(
    (container: HTMLDivElement) => {
      finishProgrammaticScroll()
      container.scrollTop = container.scrollHeight
    },
    [finishProgrammaticScroll],
  )

  useEffect(() => {
    userHasScrolledRef.current = false
    shouldAnchorToLatestMessageRef.current = conversationId !== null
  }, [conversationId, numUserMessages])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container || userHasScrolledRef.current) {
      return
    }

    if (shouldAutoScroll || shouldAnchorToLatestMessageRef.current) {
      scrollToBottom(container)
      if (!shouldAutoScroll) {
        shouldAnchorToLatestMessageRef.current = false
      }
    }
  }, [messages, scrollContainerRef, shouldAutoScroll, scrollToBottom])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const handleScroll = () => {
      if (isAutoScrollingRef.current) {
        return
      }

      userHasScrolledRef.current = !isAtBottom(container)
      if (userHasScrolledRef.current) {
        shouldAnchorToLatestMessageRef.current = false
      }
    }

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (userHasScrolledRef.current) {
              return
            }

            if (shouldAutoScroll || shouldAnchorToLatestMessageRef.current) {
              scrollToBottom(container)
              if (!shouldAutoScroll) {
                shouldAnchorToLatestMessageRef.current = false
              }
            }
          })
        : null

    container.addEventListener('scroll', handleScroll)

    if (resizeObserver) {
      resizeObserver.observe(container)
      for (const child of Array.from(container.children)) {
        resizeObserver.observe(child)
      }
    }

    return () => {
      clearAutoScrollResetTimeout()
      container.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
    }
  }, [clearAutoScrollResetTimeout, messages, scrollContainerRef, scrollToBottom, shouldAutoScroll])
}
