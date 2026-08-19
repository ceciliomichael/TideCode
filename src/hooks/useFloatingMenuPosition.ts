import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

interface UseFloatingMenuPositionInput {
  anchorRef: RefObject<HTMLElement | null>
  getAnchorRect?: () => DOMRect | null
  isOpen: boolean
  matchAnchorWidth?: boolean
  menuRef: RefObject<HTMLElement | null>
  minViewportMargin?: number
  offset?: number
  placementHeight?: number
  positionKey?: string | number | boolean | null
  preferredPlacement?: 'above' | 'below'
}

const DEFAULT_OFFSET = 6
const DEFAULT_VIEWPORT_MARGIN = 8

export function resolveFloatingMenuPlacement({
  availableAbove,
  availableBelow,
  menuHeight,
  preferredPlacement,
}: {
  availableAbove: number
  availableBelow: number
  menuHeight: number
  preferredPlacement: 'above' | 'below'
}) {
  const preferredSpace = preferredPlacement === 'above' ? availableAbove : availableBelow
  const alternateSpace = preferredPlacement === 'above' ? availableBelow : availableAbove

  if (preferredSpace >= menuHeight || preferredSpace >= alternateSpace) {
    return preferredPlacement
  }

  return preferredPlacement === 'above' ? 'below' : 'above'
}

export function useFloatingMenuPosition({
  anchorRef,
  getAnchorRect,
  isOpen,
  matchAnchorWidth = true,
  menuRef,
  minViewportMargin = DEFAULT_VIEWPORT_MARGIN,
  offset = DEFAULT_OFFSET,
  placementHeight,
  positionKey = null,
  preferredPlacement = 'below',
}: UseFloatingMenuPositionInput) {
  const [isPositioned, setIsPositioned] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    left: 0,
    maxHeight: 0,
    minWidth: 0,
    top: 0,
    visibility: 'hidden',
  })

  useLayoutEffect(() => {
    if (!isOpen) {
      setIsPositioned(false)
      return
    }

    // A portal is mounted after the trigger opens. Keep it hidden until this
    // layout pass measures the current menu instead of briefly reusing the
    // previous open position from a stale render.
    setIsPositioned(false)

    function updateMenuPosition() {
      const anchorElement = anchorRef.current
      const menuElement = menuRef.current
      const anchorRect = getAnchorRect?.() ?? anchorElement?.getBoundingClientRect()
      const menuRect = menuElement?.getBoundingClientRect()

      if (!anchorRect) {
        return
      }

      const visualViewport = window.visualViewport
      const viewportLeft = visualViewport?.offsetLeft ?? 0
      const viewportTop = visualViewport?.offsetTop ?? 0
      const viewportWidth = visualViewport?.width ?? window.innerWidth
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportRight = viewportLeft + viewportWidth
      const viewportBottom = viewportTop + viewportHeight
      const menuWidth = menuRect?.width ?? anchorRect.width
      // Use scrollHeight (intrinsic content height) for both placement and the
      // initial top calculation so the menu does not need a visible correction.
      const menuScrollHeight = menuElement?.scrollHeight ?? menuRect?.height ?? 0
      const availableBelow = Math.max(viewportBottom - anchorRect.bottom - offset - minViewportMargin, 0)
      const availableAbove = Math.max(anchorRect.top - viewportTop - offset - minViewportMargin, 0)
      const placement = resolveFloatingMenuPlacement({
        availableAbove,
        availableBelow,
        menuHeight: placementHeight ?? menuScrollHeight,
        preferredPlacement,
      })
      const shouldOpenAbove = placement === 'above'
      const maxHeight = Math.max(shouldOpenAbove ? availableAbove : availableBelow, 0)
      const unclampedLeft = anchorRect.left
      const minLeft = viewportLeft + minViewportMargin
      const maxLeft = Math.max(viewportRight - menuWidth - minViewportMargin, minLeft)
      const left = Math.min(Math.max(unclampedLeft, minLeft), maxLeft)
      // The first layout pass can still have a zero offsetHeight because the
      // previous hidden style had maxHeight: 0. The intrinsic height is already
      // available and avoids a second visible jump after the menu becomes visible.
      const menuHeight = Math.min(menuScrollHeight, maxHeight)
      const top = shouldOpenAbove
        ? Math.max(viewportTop + minViewportMargin, anchorRect.top - menuHeight - offset)
        : anchorRect.bottom + offset

      setMenuStyle({
        left,
        maxHeight,
        minWidth: matchAnchorWidth ? anchorRect.width : undefined,
        top,
        visibility: 'visible',
      })
      setIsPositioned(true)
    }

    updateMenuPosition()
    const menuElement = menuRef.current
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            updateMenuPosition()
          })
        : null

    if (resizeObserver && menuElement) {
      resizeObserver.observe(menuElement)
    }
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    window.visualViewport?.addEventListener('resize', updateMenuPosition)
    window.visualViewport?.addEventListener('scroll', updateMenuPosition)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      window.visualViewport?.removeEventListener('resize', updateMenuPosition)
      window.visualViewport?.removeEventListener('scroll', updateMenuPosition)
    }
  }, [
    anchorRef,
    getAnchorRect,
    isOpen,
    matchAnchorWidth,
    menuRef,
    minViewportMargin,
    offset,
    placementHeight,
    positionKey,
    preferredPlacement,
  ])

  const resolvedMenuStyle: CSSProperties = {
    ...menuStyle,
    visibility: isOpen && isPositioned ? 'visible' : 'hidden',
  }
  return resolvedMenuStyle
}
