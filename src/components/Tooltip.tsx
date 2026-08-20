import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useIsMobileViewport } from '../hooks/useIsMobileViewport'

interface TooltipChildProps {
  className?: string
  'aria-describedby'?: string
  'aria-expanded'?: boolean
}

interface TooltipProps {
  align?: 'center' | 'left'
  children: ReactElement<TooltipChildProps>
  content: string | ReactNode
  broadcastShowEvent?: boolean
  disabled?: boolean
  fullWidthTrigger?: boolean
  hideDelayMs?: number
  panelClassName?: string
  interactive?: boolean
  mobilePressToOpen?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
  lockSide?: boolean
  hideWhenTriggerExpanded?: boolean
  noWrap?: boolean
  triggerClassName?: string
  triggerLayout?: 'flex' | 'inline' | 'inline-flex'
}

export interface AnchoredTooltipRect {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

interface AnchoredTooltipProps {
  anchorElement: HTMLElement | null
  anchorRect?: AnchoredTooltipRect | null
  content: string | ReactNode
  noWrap?: boolean
  panelClassName?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  visible: boolean
}

const TOOLTIP_OFFSET = 6
const TOOLTIP_EDGE_PADDING = 12
const TOOLTIP_SHOW_EVENT = 'tidecode:tooltip-show'

function mergeClassNames(left: string | undefined, right: string) {
  return left ? `${left} ${right}` : right
}

function triggerHasExpandedDescendant(triggerElement: HTMLSpanElement | null) {
  if (!triggerElement) {
    return false
  }

  return (
    triggerElement.getAttribute('aria-expanded') === 'true' ||
    triggerElement.getAttribute('data-open') === 'true' ||
    triggerElement.querySelector('[aria-expanded="true"], [data-open="true"]') !== null
  )
}

export function Tooltip({
  align = 'left',
  children,
  content,
  broadcastShowEvent = true,
  disabled = false,
  fullWidthTrigger = false,
  hideDelayMs = 0,
  panelClassName,
  interactive = false,
  mobilePressToOpen = false,
  side = 'top',
  lockSide = false,
  hideWhenTriggerExpanded = false,
  noWrap = false,
  triggerClassName,
  triggerLayout = fullWidthTrigger ? 'flex' : 'inline-flex',
}: TooltipProps) {
  const isMobileViewport = useIsMobileViewport()
  const tooltipId = useId()
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const hideTimeoutRef = useRef<number | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isTriggerExpanded, setIsTriggerExpanded] = useState(false)
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({
    left: 0,
    top: 0,
    opacity: 0,
    visibility: 'hidden',
  })

  useEffect(() => {
    if (!hideWhenTriggerExpanded) {
      setIsTriggerExpanded(false)
      return
    }

    const triggerElement = triggerRef.current
    if (!triggerElement) {
      return
    }

    function syncExpandedState() {
      setIsTriggerExpanded(triggerHasExpandedDescendant(triggerElement))
    }

    syncExpandedState()

    const observer = new MutationObserver(() => {
      syncExpandedState()
    })

    observer.observe(triggerElement, {
      attributes: true,
      attributeFilter: ['aria-expanded', 'data-open'],
      childList: true,
      subtree: true,
    })

    return () => {
      observer.disconnect()
    }
  }, [children, hideWhenTriggerExpanded])

  useEffect(() => {
    if ((isMobileViewport && !mobilePressToOpen) || disabled || (hideWhenTriggerExpanded && isTriggerExpanded)) {
      setIsVisible(false)
    }
  }, [disabled, hideWhenTriggerExpanded, isMobileViewport, isTriggerExpanded, mobilePressToOpen])

  const shouldSuppressTooltip =
    (isMobileViewport && !mobilePressToOpen) || disabled || (hideWhenTriggerExpanded && isTriggerExpanded)
  const pointerEventsClassName = useMemo(
    () => (interactive ? 'pointer-events-auto' : 'pointer-events-none'),
    [interactive],
  )

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [])

  const hideTooltipImmediate = useCallback(() => {
    clearHideTimeout()
    setIsVisible(false)
  }, [clearHideTimeout])

  const showTooltip = useCallback(() => {
    if (disabled || shouldSuppressTooltip) {
      setIsVisible(false)
      return
    }

    clearHideTimeout()
    if (broadcastShowEvent) {
      window.dispatchEvent(new CustomEvent<string>(TOOLTIP_SHOW_EVENT, { detail: tooltipId }))
    }
    setIsVisible(true)
  }, [broadcastShowEvent, clearHideTimeout, disabled, shouldSuppressTooltip, tooltipId])

  const hideTooltip = useCallback(() => {
    clearHideTimeout()
    if (hideDelayMs <= 0) {
      setIsVisible(false)
      return
    }

    hideTimeoutRef.current = window.setTimeout(() => {
      hideTooltipImmediate()
      hideTimeoutRef.current = null
    }, hideDelayMs)
  }, [clearHideTimeout, hideDelayMs, hideTooltipImmediate])

  useEffect(() => {
    if (!isMobileViewport || !mobilePressToOpen || !isVisible) {
      return
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) {
        return
      }
      hideTooltipImmediate()
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [hideTooltipImmediate, isMobileViewport, isVisible, mobilePressToOpen])

  useEffect(() => {
    if (!broadcastShowEvent) {
      return
    }

    function handleTooltipShow(event: Event) {
      const customEvent = event as CustomEvent<string>
      if (customEvent.detail !== tooltipId) {
        hideTooltipImmediate()
      }
    }

    window.addEventListener(TOOLTIP_SHOW_EVENT, handleTooltipShow as EventListener)
    return () => {
      window.removeEventListener(TOOLTIP_SHOW_EVENT, handleTooltipShow as EventListener)
    }
  }, [broadcastShowEvent, hideTooltipImmediate, tooltipId])

  const updateTooltipPosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) {
      return
    }

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const visualViewport = window.visualViewport
    const viewportLeft = visualViewport?.offsetLeft ?? 0
    const viewportTop = visualViewport?.offsetTop ?? 0
    const viewportWidth = visualViewport?.width ?? window.innerWidth
    const viewportHeight = visualViewport?.height ?? window.innerHeight
    const viewportRight = viewportLeft + viewportWidth
    const viewportBottom = viewportTop + viewportHeight
    const preferredSide = side
    const fitsTop =
      triggerRect.top - viewportTop >= tooltipRect.height + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const fitsBottom =
      viewportBottom - triggerRect.bottom >= tooltipRect.height + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const fitsLeft =
      triggerRect.left - viewportLeft >= tooltipRect.width + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const fitsRight =
      viewportRight - triggerRect.right >= tooltipRect.width + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING

    const nextSide = lockSide
      ? preferredSide
      : preferredSide === 'top'
        ? fitsTop || !fitsBottom
          ? 'top'
          : 'bottom'
        : preferredSide === 'bottom'
          ? fitsBottom || !fitsTop
            ? 'bottom'
            : 'top'
          : preferredSide === 'left'
            ? fitsLeft || !fitsRight
              ? 'left'
              : 'right'
            : fitsRight || !fitsLeft
              ? 'right'
              : 'left'

    const minLeft = viewportLeft + TOOLTIP_EDGE_PADDING
    const maxLeft = Math.max(minLeft, viewportRight - tooltipRect.width - TOOLTIP_EDGE_PADDING)
    const minTop = viewportTop + TOOLTIP_EDGE_PADDING
    const maxTop = Math.max(minTop, viewportBottom - tooltipRect.height - TOOLTIP_EDGE_PADDING)
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
    const centeredTop = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2

    const left =
      nextSide === 'left'
        ? Math.max(minLeft, Math.min(triggerRect.left - tooltipRect.width - TOOLTIP_OFFSET, maxLeft))
        : nextSide === 'right'
          ? Math.max(minLeft, Math.min(triggerRect.right + TOOLTIP_OFFSET, maxLeft))
          : Math.max(minLeft, Math.min(centeredLeft, maxLeft))
    const top =
      nextSide === 'top'
        ? Math.max(minTop, Math.min(triggerRect.top - tooltipRect.height - TOOLTIP_OFFSET, maxTop))
        : nextSide === 'bottom'
          ? Math.max(minTop, Math.min(triggerRect.bottom + TOOLTIP_OFFSET, maxTop))
          : Math.max(minTop, Math.min(centeredTop, maxTop))

    setTooltipStyle({
      left,
      top,
      opacity: 1,
      visibility: 'visible',
    })
  }, [lockSide, side])

  useLayoutEffect(() => {
    if (!isVisible || shouldSuppressTooltip || !triggerRef.current || !tooltipRef.current) {
      return
    }

    updateTooltipPosition()
    window.addEventListener('scroll', updateTooltipPosition, true)
    window.addEventListener('resize', updateTooltipPosition)
    window.visualViewport?.addEventListener('resize', updateTooltipPosition)
    window.visualViewport?.addEventListener('scroll', updateTooltipPosition)

    const resizeObserver = new ResizeObserver(() => {
      updateTooltipPosition()
    })

    resizeObserver.observe(triggerRef.current)
    resizeObserver.observe(tooltipRef.current)

    return () => {
      window.removeEventListener('scroll', updateTooltipPosition, true)
      window.removeEventListener('resize', updateTooltipPosition)
      window.visualViewport?.removeEventListener('resize', updateTooltipPosition)
      window.visualViewport?.removeEventListener('scroll', updateTooltipPosition)
      resizeObserver.disconnect()
    }
  }, [isVisible, shouldSuppressTooltip, updateTooltipPosition])

  useEffect(
    () => () => {
      clearHideTimeout()
    },
    [clearHideTimeout],
  )

  if (!isValidElement<TooltipChildProps>(children)) {
    return children
  }

  const enhancedChild = cloneElement(children, {
    'aria-describedby': isVisible && !shouldSuppressTooltip ? tooltipId : undefined,
    'aria-expanded': isMobileViewport && mobilePressToOpen ? isVisible : children.props['aria-expanded'],
    className: mergeClassNames(
      typeof children.props.className === 'string' ? children.props.className : undefined,
      'outline-none',
    ),
  })

  return (
    <>
      <span
        ref={triggerRef}
        className={[
          triggerLayout,
          fullWidthTrigger ? 'w-full' : '',
          triggerClassName ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={isMobileViewport && mobilePressToOpen
          ? () => {
              if (isVisible) {
                hideTooltipImmediate()
              } else {
                showTooltip()
              }
            }
          : undefined}
        onMouseEnter={isMobileViewport ? undefined : showTooltip}
        onMouseLeave={isMobileViewport ? undefined : hideTooltip}
        onFocus={isMobileViewport ? undefined : showTooltip}
        onBlur={isMobileViewport ? undefined : hideTooltip}
      >
        {enhancedChild}
      </span>
      {isVisible && !shouldSuppressTooltip
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              onFocus={interactive ? showTooltip : undefined}
              onMouseEnter={interactive ? showTooltip : undefined}
              onMouseLeave={interactive ? hideTooltip : undefined}
              className={[
                `${pointerEventsClassName} fixed z-50 inline-flex items-center rounded-xl border border-tooltip-border bg-tooltip-surface px-3 py-2 text-xs font-medium leading-4 text-tooltip-foreground shadow-soft transition-opacity duration-150 ease-out`,
                noWrap ? 'w-max' : 'max-w-[min(18rem,calc(100vw-24px))]',
                align === 'center' ? 'text-center' : 'text-left',
                noWrap ? 'whitespace-nowrap' : '',
                panelClassName ?? '',
              ].join(' ')}
              style={tooltipStyle}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export function AnchoredTooltip({
  anchorElement,
  anchorRect,
  content,
  noWrap = false,
  panelClassName,
  side = 'top',
  visible,
}: AnchoredTooltipProps) {
  const isMobileViewport = useIsMobileViewport()
  const tooltipId = useId()
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({
    left: 0,
    top: 0,
    opacity: 0,
    visibility: 'hidden',
  })

  const updateTooltipPosition = useCallback(() => {
    if ((!anchorElement && !anchorRect) || !tooltipRef.current) {
      return
    }

    const resolvedAnchorRect = anchorRect ?? anchorElement?.getBoundingClientRect()
    if (!resolvedAnchorRect) return
    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const fitsTop = resolvedAnchorRect.top >= tooltipRect.height + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const fitsBottom = viewportHeight - resolvedAnchorRect.bottom >= tooltipRect.height + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const fitsLeft = resolvedAnchorRect.left >= tooltipRect.width + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const fitsRight = viewportWidth - resolvedAnchorRect.right >= tooltipRect.width + TOOLTIP_OFFSET + TOOLTIP_EDGE_PADDING
    const resolvedSide = side === 'top'
      ? fitsTop || !fitsBottom ? 'top' : 'bottom'
      : side === 'bottom'
        ? fitsBottom || !fitsTop ? 'bottom' : 'top'
        : side === 'left'
          ? fitsLeft || !fitsRight ? 'left' : 'right'
          : fitsRight || !fitsLeft ? 'right' : 'left'
    const minLeft = TOOLTIP_EDGE_PADDING
    const maxLeft = Math.max(TOOLTIP_EDGE_PADDING, viewportWidth - tooltipRect.width - TOOLTIP_EDGE_PADDING)
    const minTop = TOOLTIP_EDGE_PADDING
    const maxTop = Math.max(TOOLTIP_EDGE_PADDING, viewportHeight - tooltipRect.height - TOOLTIP_EDGE_PADDING)
    const centeredLeft = resolvedAnchorRect.left + resolvedAnchorRect.width / 2 - tooltipRect.width / 2
    const centeredTop = resolvedAnchorRect.top + resolvedAnchorRect.height / 2 - tooltipRect.height / 2
    const left = resolvedSide === 'left'
      ? Math.max(minLeft, Math.min(resolvedAnchorRect.left - tooltipRect.width - TOOLTIP_OFFSET, maxLeft))
      : resolvedSide === 'right'
        ? Math.max(minLeft, Math.min(resolvedAnchorRect.right + TOOLTIP_OFFSET, maxLeft))
        : Math.max(minLeft, Math.min(centeredLeft, maxLeft))
    const top = resolvedSide === 'top'
      ? Math.max(minTop, Math.min(resolvedAnchorRect.top - tooltipRect.height - TOOLTIP_OFFSET, maxTop))
      : resolvedSide === 'bottom'
        ? Math.max(minTop, Math.min(resolvedAnchorRect.bottom + TOOLTIP_OFFSET, maxTop))
        : Math.max(minTop, Math.min(centeredTop, maxTop))

    setTooltipStyle({ left, top, opacity: 1, visibility: 'visible' })
}, [anchorElement, anchorRect, side])

  useLayoutEffect(() => {
    if (isMobileViewport || !visible || (!anchorElement && !anchorRect) || !tooltipRef.current) {
      return
    }

    window.dispatchEvent(new CustomEvent<string>(TOOLTIP_SHOW_EVENT, { detail: tooltipId }))
    updateTooltipPosition()
    window.addEventListener('scroll', updateTooltipPosition, true)
    window.addEventListener('resize', updateTooltipPosition)
    const resizeObserver = new ResizeObserver(updateTooltipPosition)
    if (anchorElement) resizeObserver.observe(anchorElement)
    resizeObserver.observe(tooltipRef.current)

    return () => {
      window.removeEventListener('scroll', updateTooltipPosition, true)
      window.removeEventListener('resize', updateTooltipPosition)
      resizeObserver.disconnect()
    }
  }, [anchorElement, anchorRect, isMobileViewport, tooltipId, updateTooltipPosition, visible])

  if (isMobileViewport || !visible || (!anchorElement && !anchorRect)) {
    return null
  }

  return createPortal(
    <div
      ref={tooltipRef}
      id={tooltipId}
      role="tooltip"
      className={[
        'pointer-events-none fixed z-50 inline-flex items-center rounded-xl border border-tooltip-border bg-tooltip-surface px-3 py-2 text-xs font-medium leading-4 text-tooltip-foreground shadow-soft transition-opacity duration-150 ease-out',
        noWrap ? 'w-max whitespace-nowrap' : 'max-w-[min(18rem,calc(100vw-24px))]',
        panelClassName ?? '',
      ].join(' ')}
      style={tooltipStyle}
    >
      {content}
    </div>,
    document.body,
  )
}
