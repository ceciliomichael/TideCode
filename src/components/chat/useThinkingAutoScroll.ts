import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 24

function isAtBottom(container: HTMLDivElement) {
  return Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < AUTO_SCROLL_BOTTOM_THRESHOLD_PX
}

interface UseThinkingAutoScrollOptions {
  content: string
  isStreaming: boolean
}

export function useThinkingAutoScroll({ content, isStreaming }: UseThinkingAutoScrollOptions): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null)
  const userHasScrolledRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [])

  useEffect(() => {
    if (isStreaming) {
      userHasScrolledRef.current = false
    }
  }, [isStreaming])

  useLayoutEffect(() => {
    if (!isStreaming || userHasScrolledRef.current) {
      return
    }

    scrollToBottom()
  }, [content, isStreaming, scrollToBottom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const handleScroll = () => {
      userHasScrolledRef.current = !isAtBottom(container)
    }

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (isStreaming && !userHasScrolledRef.current) {
              scrollToBottom()
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
      container.removeEventListener('scroll', handleScroll)
      resizeObserver?.disconnect()
    }
  }, [isStreaming, scrollToBottom])

  return containerRef
}
