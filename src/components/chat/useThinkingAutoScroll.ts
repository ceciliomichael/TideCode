import { useRef, type RefObject } from 'react'
import { useScrollFollower } from './useScrollFollower'

interface UseThinkingAutoScrollOptions {
  content: string
  isStreaming: boolean
}

export function useThinkingAutoScroll({ content, isStreaming }: UseThinkingAutoScrollOptions): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null)

  useScrollFollower({
    anchorOnReset: true,
    contentRevision: content,
    isAutoFollowEnabled: isStreaming,
    scrollContainerRef: containerRef,
  })

  return containerRef
}
