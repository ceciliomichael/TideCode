import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import {
  getScrollContainerMetrics,
  getScrollContainerSnapshot,
  resolveScrollFollowing,
  shouldMeasureScrollContainerLayout,
  type ScrollContainerSnapshot,
} from './scrollFollowPolicy'

export interface UseScrollFollowerOptions {
  anchorOnReset?: boolean
  contentRevision: unknown
  isAutoFollowEnabled: boolean
  resetSignal?: string | number | null
  scrollContainerRef: RefObject<HTMLDivElement>
}

export interface ScrollFollowerControls {
  pauseFollowingLatest: () => void
}

function useScrollFollower({
  anchorOnReset = false,
  contentRevision,
  isAutoFollowEnabled,
  resetSignal = null,
  scrollContainerRef,
}: UseScrollFollowerOptions): ScrollFollowerControls {
  const isFollowingLatestRef = useRef(true)
  const isAutoFollowEnabledRef = useRef(isAutoFollowEnabled)
  const shouldAnchorToLatestRef = useRef(anchorOnReset)
  const previousResetSignalRef = useRef<string | number | null | undefined>(resetSignal)
  const lastObservedSnapshotRef = useRef<ScrollContainerSnapshot | null>(null)
  const scheduledFrameRef = useRef<number | null>(null)
  const scheduledFrameTypeRef = useRef<'animation' | 'timeout' | null>(null)
  const scrollObservationFrameRef = useRef<number | null>(null)
  const scrollObservationFrameTypeRef = useRef<'animation' | 'timeout' | null>(null)
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

  const cancelScheduledScrollObservation = useCallback(() => {
    if (scrollObservationFrameRef.current === null || typeof window === 'undefined') {
      return
    }

    if (scrollObservationFrameTypeRef.current === 'animation') {
      window.cancelAnimationFrame(scrollObservationFrameRef.current)
    } else {
      window.clearTimeout(scrollObservationFrameRef.current)
    }

    scrollObservationFrameRef.current = null
    scrollObservationFrameTypeRef.current = null
  }, [])

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
      userGestureActiveRef.current ||
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

  const processScrollObservation = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const previousSnapshot = lastObservedSnapshotRef.current
    const currentScrollTop = container.scrollTop
    const wasFollowingLatest = isFollowingLatestRef.current

    if (
      previousSnapshot &&
      !shouldMeasureScrollContainerLayout(wasFollowingLatest, previousSnapshot.scrollTop, currentScrollTop)
    ) {
      lastObservedSnapshotRef.current = {
        ...previousSnapshot,
        scrollTop: currentScrollTop,
      }
      return
    }

    const currentSnapshot = getScrollContainerSnapshot(container)
    const comparisonSnapshot = previousSnapshot ?? currentSnapshot
    const shouldFollowLatest = resolveScrollFollowing({
      current: currentSnapshot,
      isFollowingLatest: wasFollowingLatest,
      previous: comparisonSnapshot,
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

  const handleScroll = useCallback(() => {
    if (scrollObservationFrameRef.current !== null || typeof window === 'undefined') {
      return
    }

    const runObservation = () => {
      scrollObservationFrameRef.current = null
      scrollObservationFrameTypeRef.current = null
      processScrollObservation()
    }

    if (typeof window.requestAnimationFrame === 'function') {
      scrollObservationFrameTypeRef.current = 'animation'
      scrollObservationFrameRef.current = window.requestAnimationFrame(runObservation)
      return
    }

    scrollObservationFrameTypeRef.current = 'timeout'
    scrollObservationFrameRef.current = window.setTimeout(runObservation, 0)
  }, [processScrollObservation])

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
    scheduleAutoScroll()
  }, [scheduleAutoScroll])

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
    scheduleAutoScroll()
  }, [scheduleAutoScroll])

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
      cancelScheduledScrollObservation()
    }
  }, [
    cancelScheduledFollow,
    cancelScheduledScrollObservation,
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

  return { pauseFollowingLatest }
}

export { useScrollFollower }
