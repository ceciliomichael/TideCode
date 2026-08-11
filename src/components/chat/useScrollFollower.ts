import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import {
  getScrollContainerMetrics,
  getScrollContainerSnapshot,
  resolveScrollFollowing,
  type ScrollContainerSnapshot,
} from './scrollFollowPolicy'

export interface UseScrollFollowerOptions {
  anchorOnReset?: boolean
  contentRevision: unknown
  isAutoFollowEnabled: boolean
  resetSignal?: string | number | null
  scrollContainerRef: RefObject<HTMLDivElement>
}

function useScrollFollower({
  anchorOnReset = false,
  contentRevision,
  isAutoFollowEnabled,
  resetSignal = null,
  scrollContainerRef,
}: UseScrollFollowerOptions): void {
  const isFollowingLatestRef = useRef(true)
  const isAutoFollowEnabledRef = useRef(isAutoFollowEnabled)
  const shouldAnchorToLatestRef = useRef(anchorOnReset)
  const previousResetSignalRef = useRef<string | number | null | undefined>(resetSignal)
  const lastObservedSnapshotRef = useRef<ScrollContainerSnapshot | null>(null)
  const scheduledFrameRef = useRef<number | null>(null)
  const scheduledFrameTypeRef = useRef<'animation' | 'timeout' | null>(null)
  const lastTouchYRef = useRef<number | null>(null)
  const userGestureActiveRef = useRef(false)

  isAutoFollowEnabledRef.current = isAutoFollowEnabled

  const updateFollowingLatest = useCallback((nextValue: boolean) => {
    isFollowingLatestRef.current = nextValue
  }, [])

  const cancelScheduledFollow = useCallback(() => {
    if (scheduledFrameRef.current === null || typeof window === 'undefined') {
      return
    }

    if (scheduledFrameTypeRef.current === 'animation') {
      window.cancelAnimationFrame(scheduledFrameRef.current)
    } else {
      window.clearTimeout(scheduledFrameRef.current)
    }

    scheduledFrameRef.current = null
    scheduledFrameTypeRef.current = null
  }, [])

  const pauseFollowingLatest = useCallback(() => {
    cancelScheduledFollow()
    updateFollowingLatest(false)
  }, [cancelScheduledFollow, updateFollowingLatest])

  const performInstantScrollToLatest = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const { maxScrollTop } = getScrollContainerMetrics(container)
    container.scrollTop = maxScrollTop
    lastObservedSnapshotRef.current = getScrollContainerSnapshot(container)
  }, [scrollContainerRef])

  const scheduleAutoScroll = useCallback(() => {
    if (
      !isAutoFollowEnabledRef.current ||
      !isFollowingLatestRef.current ||
      scheduledFrameRef.current !== null ||
      typeof window === 'undefined'
    ) {
      return
    }

    const runScroll = () => {
      scheduledFrameRef.current = null
      scheduledFrameTypeRef.current = null

      if (!isAutoFollowEnabledRef.current || !isFollowingLatestRef.current) {
        return
      }

      performInstantScrollToLatest()
    }

    if (typeof window.requestAnimationFrame === 'function') {
      scheduledFrameTypeRef.current = 'animation'
      scheduledFrameRef.current = window.requestAnimationFrame(runScroll)
      return
    }

    scheduledFrameTypeRef.current = 'timeout'
    scheduledFrameRef.current = window.setTimeout(runScroll, 0)
  }, [performInstantScrollToLatest])

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const currentSnapshot = getScrollContainerSnapshot(container)
    const previousSnapshot = lastObservedSnapshotRef.current ?? currentSnapshot
    const wasFollowingLatest = isFollowingLatestRef.current
    const shouldFollowLatest = resolveScrollFollowing({
      current: currentSnapshot,
      isFollowingLatest: wasFollowingLatest,
      previous: previousSnapshot,
    })
    lastObservedSnapshotRef.current = currentSnapshot

    if (!shouldFollowLatest) {
      pauseFollowingLatest()
      return
    }

    if (!wasFollowingLatest) {
      updateFollowingLatest(true)
      scheduleAutoScroll()
    }
  }, [pauseFollowingLatest, scheduleAutoScroll, scrollContainerRef, updateFollowingLatest])

  const handleWheel = useCallback((event: WheelEvent) => {
    if (Math.abs(event.deltaY) <= 1) {
      return
    }

    if (event.deltaY < -1) {
      pauseFollowingLatest()
    }
  }, [pauseFollowingLatest])

  const handleUserInteractionStart = useCallback(() => {
    userGestureActiveRef.current = true
    cancelScheduledFollow()
  }, [cancelScheduledFollow])

  const handleUserInteractionEnd = useCallback(() => {
    userGestureActiveRef.current = false
  }, [])

  const handleTouchStart = useCallback((event: TouchEvent) => {
    userGestureActiveRef.current = true
    lastTouchYRef.current = event.touches[0]?.clientY ?? null
    cancelScheduledFollow()
  }, [cancelScheduledFollow])

  const handleTouchMove = useCallback((event: TouchEvent) => {
    const currentTouchY = event.touches[0]?.clientY
    const previousTouchY = lastTouchYRef.current
    if (currentTouchY === undefined) {
      return
    }

    if (previousTouchY !== null && currentTouchY > previousTouchY + 1) {
      pauseFollowingLatest()
    }

    lastTouchYRef.current = currentTouchY
  }, [pauseFollowingLatest])

  const handleTouchEnd = useCallback(() => {
    userGestureActiveRef.current = false
    lastTouchYRef.current = null
  }, [])

  useLayoutEffect(() => {
    if (Object.is(previousResetSignalRef.current, resetSignal)) {
      return
    }

    previousResetSignalRef.current = resetSignal
    if (!anchorOnReset) {
      return
    }

    shouldAnchorToLatestRef.current = true
    cancelScheduledFollow()
    updateFollowingLatest(true)
  }, [anchorOnReset, cancelScheduledFollow, resetSignal, updateFollowingLatest])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    if (shouldAnchorToLatestRef.current) {
      shouldAnchorToLatestRef.current = false
      cancelScheduledFollow()
      updateFollowingLatest(true)
      performInstantScrollToLatest()
      scheduleAutoScroll()
      return
    }

    if (isAutoFollowEnabledRef.current && isFollowingLatestRef.current && !userGestureActiveRef.current) {
      performInstantScrollToLatest()
    }
    scheduleAutoScroll()
  }, [
    cancelScheduledFollow,
    contentRevision,
    isAutoFollowEnabled,
    performInstantScrollToLatest,
    resetSignal,
    scheduleAutoScroll,
    scrollContainerRef,
    updateFollowingLatest,
  ])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    lastObservedSnapshotRef.current = getScrollContainerSnapshot(container)

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            scheduleAutoScroll()
          })
        : null

    const observeResizableChildren = () => {
      if (!resizeObserver) {
        return
      }

      resizeObserver.observe(container)
      for (const child of Array.from(container.children)) {
        resizeObserver.observe(child)
      }
    }

    observeResizableChildren()

    const mutationObserver =
      typeof MutationObserver === 'function'
        ? new MutationObserver(() => {
            observeResizableChildren()
            scheduleAutoScroll()
          })
        : null

    mutationObserver?.observe(container, { childList: true, subtree: true })

    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('pointerdown', handleUserInteractionStart, { passive: true })
    container.addEventListener('pointerup', handleUserInteractionEnd, { passive: true })
    container.addEventListener('pointercancel', handleUserInteractionEnd, { passive: true })
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('pointerdown', handleUserInteractionStart)
      container.removeEventListener('pointerup', handleUserInteractionEnd)
      container.removeEventListener('pointercancel', handleUserInteractionEnd)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchcancel', handleTouchEnd)
      mutationObserver?.disconnect()
      resizeObserver?.disconnect()
      cancelScheduledFollow()
    }
  }, [
    cancelScheduledFollow,
    handleScroll,
    handleUserInteractionEnd,
    handleUserInteractionStart,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    handleWheel,
    scheduleAutoScroll,
    scrollContainerRef,
  ])
}

export { useScrollFollower }
