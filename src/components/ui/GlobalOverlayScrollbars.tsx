import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  GLOBAL_OVERLAY_SCROLLBAR_UPDATE_EVENT,
  getCustomOverlayScrollTarget,
  type CustomScrollTarget,
  type ScrollAxis,
  type ScrollMetrics,
} from './globalOverlayScrollbarTargets'

type ActiveScrollTarget = HTMLElement | CustomScrollTarget

interface ActiveScrollTargets {
  horizontal: ActiveScrollTarget | null
  vertical: ActiveScrollTarget | null
}

interface DragState {
  axis: ScrollAxis
  pointerId: number
  scrollRange: number
  startPointerPosition: number
  startScrollPosition: number
  target: ActiveScrollTarget
  thumbTravel: number
}

interface ThumbGeometry {
  height: number
  left: number
  maxScroll: number
  maxThumbTravel: number
  top: number
  width: number
}

const SCROLLBAR_SIZE_PX = 8
const MIN_THUMB_SIZE_PX = 24
const OVERFLOW_VALUES = new Set(['auto', 'overlay', 'scroll'])

function getTargetElement(target: ActiveScrollTarget) {
  return target instanceof HTMLElement ? target : target.element
}

function getTargetMetrics(target: ActiveScrollTarget): ScrollMetrics {
  if (!(target instanceof HTMLElement)) {
    return target.getMetrics()
  }

  return {
    clientHeight: target.clientHeight,
    clientWidth: target.clientWidth,
    scrollHeight: target.scrollHeight,
    scrollLeft: target.scrollLeft,
    scrollTop: target.scrollTop,
    scrollWidth: target.scrollWidth,
  }
}

function setTargetScrollPosition(target: ActiveScrollTarget, axis: ScrollAxis, position: number) {
  if (!(target instanceof HTMLElement)) {
    target.setScrollPosition(axis, position)
    return
  }

  if (axis === 'vertical') {
    target.scrollTop = position
  } else {
    target.scrollLeft = position
  }
}

function isScrollableOnAxis(element: HTMLElement, axis: ScrollAxis) {
  const style = window.getComputedStyle(element)
  const overflow = axis === 'vertical' ? style.overflowY : style.overflowX
  if (!OVERFLOW_VALUES.has(overflow)) {
    return false
  }

  return axis === 'vertical'
    ? element.scrollHeight > element.clientHeight + 1
    : element.scrollWidth > element.clientWidth + 1
}

function isCustomTargetScrollableOnAxis(target: CustomScrollTarget, axis: ScrollAxis) {
  const metrics = target.getMetrics()
  return axis === 'vertical'
    ? metrics.scrollHeight > metrics.clientHeight + 1
    : metrics.scrollWidth > metrics.clientWidth + 1
}

function findHoveredScrollTargets(target: EventTarget | null): ActiveScrollTargets {
  let element = target instanceof Element ? target : null
  let horizontal: ActiveScrollTarget | null = null
  let vertical: ActiveScrollTarget | null = null

  while (element && element !== document.body) {
    if (element instanceof HTMLElement && !element.classList.contains('workspace-tabs-scroll-viewport')) {
      const customTarget = getCustomOverlayScrollTarget(element)
      if (customTarget) {
        if (!vertical && isCustomTargetScrollableOnAxis(customTarget, 'vertical')) {
          vertical = customTarget
        }
        if (!horizontal && isCustomTargetScrollableOnAxis(customTarget, 'horizontal')) {
          horizontal = customTarget
        }
      } else {
        if (!vertical && isScrollableOnAxis(element, 'vertical')) {
          vertical = element
        }
        if (!horizontal && isScrollableOnAxis(element, 'horizontal')) {
          horizontal = element
        }
      }
      if (vertical && horizontal) {
        break
      }
    }

    element = element.parentElement
  }

  return { horizontal, vertical }
}

function getThumbGeometry(target: ActiveScrollTarget, axis: ScrollAxis, reserveCorner: boolean): ThumbGeometry | null {
  const element = getTargetElement(target)
  if (!element.isConnected || element.clientWidth <= 0 || element.clientHeight <= 0) {
    return null
  }

  const metrics = getTargetMetrics(target)
  const rect = element.getBoundingClientRect()
  const clientLeft = rect.left + element.clientLeft
  const clientTop = rect.top + element.clientTop
  const cornerSize = reserveCorner ? SCROLLBAR_SIZE_PX : 0

  if (axis === 'vertical') {
    const trackSize = Math.max(0, metrics.clientHeight - cornerSize)
    const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
    if (trackSize <= 0 || maxScroll <= 0) {
      return null
    }

    const thumbSize = Math.min(
      trackSize,
      Math.max(MIN_THUMB_SIZE_PX, (metrics.clientHeight / metrics.scrollHeight) * trackSize),
    )
    const maxThumbTravel = Math.max(0, trackSize - thumbSize)
    const thumbOffset = maxScroll > 0 ? (metrics.scrollTop / maxScroll) * maxThumbTravel : 0

    return {
      height: thumbSize,
      left: clientLeft + metrics.clientWidth - SCROLLBAR_SIZE_PX,
      maxScroll,
      maxThumbTravel,
      top: clientTop + thumbOffset,
      width: SCROLLBAR_SIZE_PX,
    }
  }

  const trackSize = Math.max(0, metrics.clientWidth - cornerSize)
  const maxScroll = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
  if (trackSize <= 0 || maxScroll <= 0) {
    return null
  }

  const thumbSize = Math.min(
    trackSize,
    Math.max(MIN_THUMB_SIZE_PX, (metrics.clientWidth / metrics.scrollWidth) * trackSize),
  )
  const maxThumbTravel = Math.max(0, trackSize - thumbSize)
  const thumbOffset = maxScroll > 0 ? (metrics.scrollLeft / maxScroll) * maxThumbTravel : 0

  return {
    height: SCROLLBAR_SIZE_PX,
    left: clientLeft + thumbOffset,
    maxScroll,
    maxThumbTravel,
    top: clientTop + metrics.clientHeight - SCROLLBAR_SIZE_PX,
    width: thumbSize,
  }
}

function applyThumbGeometry(element: HTMLDivElement | null, geometry: ThumbGeometry | null) {
  if (!element) {
    return
  }

  if (!geometry) {
    element.style.display = 'none'
    return
  }

  element.style.display = 'block'
  element.style.height = geometry.height + 'px'
  element.style.left = geometry.left + 'px'
  element.style.top = geometry.top + 'px'
  element.style.width = geometry.width + 'px'
}

export function GlobalOverlayScrollbars() {
  const activeTargetsRef = useRef<ActiveScrollTargets>({ horizontal: null, vertical: null })
  const dragStateRef = useRef<DragState | null>(null)
  const horizontalThumbRef = useRef<HTMLDivElement | null>(null)
  const verticalThumbRef = useRef<HTMLDivElement | null>(null)
  const updateThumbsRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    let animationFrameId = 0
    const resizeObserver = new ResizeObserver(() => scheduleThumbUpdate())
    const mutationObserver = new MutationObserver(() => scheduleThumbUpdate())

    function updateObservedTargets() {
      resizeObserver.disconnect()
      mutationObserver.disconnect()

      const uniqueTargets = new Set(
        [activeTargetsRef.current.vertical, activeTargetsRef.current.horizontal].filter(
          (target): target is ActiveScrollTarget => target !== null,
        ),
      )

      for (const target of uniqueTargets) {
        const element = getTargetElement(target)
        resizeObserver.observe(element)
        mutationObserver.observe(element, { childList: true, characterData: true, subtree: true })
      }
    }

    function updateThumbs() {
      animationFrameId = 0
      const { horizontal, vertical } = activeTargetsRef.current
      const reserveCorner = horizontal !== null && horizontal === vertical

      applyThumbGeometry(
        verticalThumbRef.current,
        vertical ? getThumbGeometry(vertical, 'vertical', reserveCorner) : null,
      )
      applyThumbGeometry(
        horizontalThumbRef.current,
        horizontal ? getThumbGeometry(horizontal, 'horizontal', reserveCorner) : null,
      )
    }

    function scheduleThumbUpdate() {
      if (animationFrameId !== 0) {
        return
      }
      animationFrameId = window.requestAnimationFrame(updateThumbs)
    }

    function setActiveTargets(nextTargets: ActiveScrollTargets) {
      const currentTargets = activeTargetsRef.current
      if (
        currentTargets.horizontal === nextTargets.horizontal &&
        currentTargets.vertical === nextTargets.vertical
      ) {
        scheduleThumbUpdate()
        return
      }

      activeTargetsRef.current = nextTargets
      updateObservedTargets()
      scheduleThumbUpdate()
    }

    function hideThumbs() {
      if (dragStateRef.current) {
        return
      }
      setActiveTargets({ horizontal: null, vertical: null })
    }

    function handlePointerOver(event: PointerEvent) {
      if (dragStateRef.current) {
        return
      }

      const target = event.target
      if (target instanceof Element && target.closest('[data-global-overlay-scrollbar-thumb]')) {
        return
      }

      setActiveTargets(findHoveredScrollTargets(target))
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      const pointerPosition = dragState.axis === 'vertical' ? event.clientY : event.clientX
      const pointerDelta = pointerPosition - dragState.startPointerPosition
      const scrollDelta =
        dragState.thumbTravel > 0 ? (pointerDelta / dragState.thumbTravel) * dragState.scrollRange : 0
      const nextScrollPosition = Math.min(
        dragState.scrollRange,
        Math.max(0, dragState.startScrollPosition + scrollDelta),
      )

      if (dragState.axis === 'vertical') {
        setTargetScrollPosition(dragState.target, 'vertical', nextScrollPosition)
      } else {
        setTargetScrollPosition(dragState.target, 'horizontal', nextScrollPosition)
      }
      scheduleThumbUpdate()
    }

    function handlePointerUp(event: PointerEvent) {
      if (dragStateRef.current?.pointerId !== event.pointerId) {
        return
      }

      dragStateRef.current = null
      scheduleThumbUpdate()
    }

    updateThumbsRef.current = updateThumbs
    document.addEventListener('pointerover', handlePointerOver, true)
    document.addEventListener('pointermove', handlePointerMove, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('pointercancel', handlePointerUp, true)
    document.addEventListener('scroll', scheduleThumbUpdate, true)
    document.documentElement.addEventListener('pointerleave', hideThumbs)
    window.addEventListener('blur', hideThumbs)
    window.addEventListener('resize', scheduleThumbUpdate)
    window.addEventListener(GLOBAL_OVERLAY_SCROLLBAR_UPDATE_EVENT, scheduleThumbUpdate)

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId)
      }
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      document.removeEventListener('pointerover', handlePointerOver, true)
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('pointercancel', handlePointerUp, true)
      document.removeEventListener('scroll', scheduleThumbUpdate, true)
      document.documentElement.removeEventListener('pointerleave', hideThumbs)
      window.removeEventListener('blur', hideThumbs)
      window.removeEventListener('resize', scheduleThumbUpdate)
      window.removeEventListener(GLOBAL_OVERLAY_SCROLLBAR_UPDATE_EVENT, scheduleThumbUpdate)
      updateThumbsRef.current = () => undefined
    }
  }, [])

  function startDrag(axis: ScrollAxis, event: ReactPointerEvent<HTMLDivElement>) {
    const target = activeTargetsRef.current[axis]
    if (!target) {
      return
    }

    const { horizontal, vertical } = activeTargetsRef.current
    const geometry = getThumbGeometry(target, axis, horizontal !== null && horizontal === vertical)
    if (!geometry || geometry.maxThumbTravel <= 0) {
      return
    }

    const metrics = getTargetMetrics(target)

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      axis,
      pointerId: event.pointerId,
      scrollRange: geometry.maxScroll,
      startPointerPosition: axis === 'vertical' ? event.clientY : event.clientX,
      startScrollPosition: axis === 'vertical' ? metrics.scrollTop : metrics.scrollLeft,
      target,
      thumbTravel: geometry.maxThumbTravel,
    }
    updateThumbsRef.current()
  }

  return (
    <>
      <div
        ref={verticalThumbRef}
        aria-hidden="true"
        data-global-overlay-scrollbar-thumb="vertical"
        className="global-overlay-scrollbar-thumb"
        onPointerDown={(event) => startDrag('vertical', event)}
      />
      <div
        ref={horizontalThumbRef}
        aria-hidden="true"
        data-global-overlay-scrollbar-thumb="horizontal"
        className="global-overlay-scrollbar-thumb"
        onPointerDown={(event) => startDrag('horizontal', event)}
      />
    </>
  )
}
