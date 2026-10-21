import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { getOverlayViewport } from '../lib/overlayViewport'

interface UseFloatingMenuPositionInput {
  anchorRef: RefObject<HTMLElement | null>
  anchorPoint?: { x: number; y: number } | null
  getAnchorRect?: () => DOMRect | null
  isOpen: boolean
  matchAnchorWidth?: boolean
  menuRef: RefObject<HTMLElement | null>
  minViewportMargin?: number
  offset?: number
  placementHeight?: number
  positionKey?: string | number | boolean | null
  preferredPlacement?: 'above' | 'below'
  preferredHorizontalPlacement?: 'left' | 'right'
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

export function resolveFloatingMenuHorizontalPlacement({
  availableLeft,
  availableRight,
  menuWidth,
  preferredPlacement,
}: {
  availableLeft: number
  availableRight: number
  menuWidth: number
  preferredPlacement: 'left' | 'right'
}) {
  const preferredSpace = preferredPlacement === 'left' ? availableLeft : availableRight
  const alternateSpace = preferredPlacement === 'left' ? availableRight : availableLeft

  if (preferredSpace >= menuWidth || preferredSpace >= alternateSpace) {
    return preferredPlacement
  }

  return preferredPlacement === 'left' ? 'right' : 'left'
}

export function resolveFloatingMenuSideTop({
  anchorBottom,
  anchorTop,
  maxTop,
  menuHeight,
  minTop,
}: {
  anchorBottom: number
  anchorTop: number
  maxTop: number
  menuHeight: number
  minTop: number
}) {
  let top = anchorTop
  if (anchorTop > maxTop) {
    top = anchorBottom - menuHeight
  }

  return Math.min(Math.max(top, minTop), maxTop)
}

export function resolveFloatingMenuPointPosition({
  menuHeight,
  menuWidth,
  minViewportMargin,
  pointX,
  pointY,
  viewportBottom,
  viewportLeft,
  viewportRight,
  viewportTop,
}: {
  menuHeight: number
  menuWidth: number
  minViewportMargin: number
  pointX: number
  pointY: number
  viewportBottom: number
  viewportLeft: number
  viewportRight: number
  viewportTop: number
}) {
  const minLeft = viewportLeft + minViewportMargin
  const maxLeft = Math.max(viewportRight - menuWidth - minViewportMargin, minLeft)
  const minTop = viewportTop + minViewportMargin
  const maxTop = Math.max(viewportBottom - menuHeight - minViewportMargin, minTop)

  return {
    left: Math.min(Math.max(pointX, minLeft), maxLeft),
    top: Math.min(Math.max(pointY, minTop), maxTop),
  }
}

export function useFloatingMenuPosition({
  anchorRef,
  anchorPoint,
  getAnchorRect,
  isOpen,
  matchAnchorWidth = true,
  menuRef,
  minViewportMargin = DEFAULT_VIEWPORT_MARGIN,
  offset = DEFAULT_OFFSET,
  placementHeight,
  positionKey = null,
  preferredPlacement = 'below',
  preferredHorizontalPlacement,
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
      const anchorRect = anchorPoint
        ? null
        : getAnchorRect?.() ?? anchorElement?.getBoundingClientRect()
      const menuRect = menuElement?.getBoundingClientRect()

      if (!anchorPoint && !anchorRect) {
        return
      }

      const {
        left: viewportLeft,
        top: viewportTop,
        right: viewportRight,
        bottom: viewportBottom,
      } = getOverlayViewport(menuElement ?? null)
      // Use scrollHeight (intrinsic content height) for both placement and the
      // initial top calculation so the menu does not need a visible correction.
      const menuScrollHeight = menuElement?.scrollHeight ?? menuRect?.height ?? 0

      if (anchorPoint) {
        const maxHeight = Math.max(viewportBottom - viewportTop - minViewportMargin * 2, 0)
        const menuHeight = Math.min(menuScrollHeight, maxHeight)
        const { left, top } = resolveFloatingMenuPointPosition({
          menuHeight,
          menuWidth: menuRect?.width ?? 0,
          minViewportMargin,
          pointX: anchorPoint.x,
          pointY: anchorPoint.y,
          viewportBottom,
          viewportLeft,
          viewportRight,
          viewportTop,
        })

        setMenuStyle({
          left,
          maxHeight,
          top,
          visibility: 'visible',
        })
        setIsPositioned(true)
        return
      }

      if (!anchorRect) {
        return
      }

      const menuWidth = menuRect?.width ?? anchorRect.width
      const availableBelow = Math.max(viewportBottom - anchorRect.bottom - offset - minViewportMargin, 0)
      const availableAbove = Math.max(anchorRect.top - viewportTop - offset - minViewportMargin, 0)
      const availableRight = Math.max(viewportRight - anchorRect.right - offset - minViewportMargin, 0)
      const availableLeft = Math.max(anchorRect.left - viewportLeft - offset - minViewportMargin, 0)
      let horizontalPlacement: 'left' | 'right' | null = null
      if (preferredHorizontalPlacement) {
        horizontalPlacement = resolveFloatingMenuHorizontalPlacement({
          availableLeft,
          availableRight,
          menuWidth,
          preferredPlacement: preferredHorizontalPlacement,
        })
      }
      let placement: 'above' | 'below' | null = null
      if (!horizontalPlacement) {
        placement = resolveFloatingMenuPlacement({
          availableAbove,
          availableBelow,
          menuHeight: placementHeight ?? menuScrollHeight,
          preferredPlacement,
        })
      }
      const shouldOpenAbove = placement === 'above'
      let maxHeight: number
      if (horizontalPlacement) {
        maxHeight = Math.max(viewportBottom - viewportTop - minViewportMargin * 2, 0)
      } else {
        maxHeight = Math.max(shouldOpenAbove ? availableAbove : availableBelow, 0)
      }
      const menuHeight = Math.min(menuScrollHeight, maxHeight)
      const minLeft = viewportLeft + minViewportMargin
      const maxLeft = Math.max(viewportRight - menuWidth - minViewportMargin, minLeft)
      let unclampedLeft = anchorRect.left
      if (horizontalPlacement === 'right') {
        unclampedLeft = anchorRect.right + offset
      } else if (horizontalPlacement === 'left') {
        unclampedLeft = anchorRect.left - menuWidth - offset
      }
      const left = Math.min(Math.max(unclampedLeft, minLeft), maxLeft)
      let top: number
      if (horizontalPlacement) {
        const minTop = viewportTop + minViewportMargin
        const maxTop = Math.max(viewportBottom - minViewportMargin - menuHeight, minTop)
        top = resolveFloatingMenuSideTop({
          anchorBottom: anchorRect.bottom,
          anchorTop: anchorRect.top,
          maxTop,
          menuHeight,
          minTop,
        })
      } else if (shouldOpenAbove) {
        top = Math.max(viewportTop + minViewportMargin, anchorRect.top - menuHeight - offset)
      } else {
        top = anchorRect.bottom + offset
      }

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
    anchorPoint,
    getAnchorRect,
    isOpen,
    matchAnchorWidth,
    menuRef,
    minViewportMargin,
    offset,
    placementHeight,
    positionKey,
    preferredPlacement,
    preferredHorizontalPlacement,
  ])

  const resolvedMenuStyle: CSSProperties = {
    ...menuStyle,
    visibility: isOpen && isPositioned ? 'visible' : 'hidden',
  }
  return resolvedMenuStyle
}
