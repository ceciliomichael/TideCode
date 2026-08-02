import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

interface UseFloatingMenuPositionInput {
  anchorRef: RefObject<HTMLElement | null>
  getAnchorRect?: () => DOMRect | null
  isOpen: boolean
  matchAnchorWidth?: boolean
  menuRef: RefObject<HTMLElement | null>
  minViewportMargin?: number
  offset?: number
  preferredPlacement?: 'above' | 'below'
}

const DEFAULT_OFFSET = 6
const DEFAULT_VIEWPORT_MARGIN = 8

export function useFloatingMenuPosition({
  anchorRef,
  getAnchorRect,
  isOpen,
  matchAnchorWidth = true,
  menuRef,
  minViewportMargin = DEFAULT_VIEWPORT_MARGIN,
  offset = DEFAULT_OFFSET,
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

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const menuWidth = menuRect?.width ?? anchorRect.width
      // Use scrollHeight (intrinsic content height) for both placement and the
      // initial top calculation so the menu does not need a visible correction.
      const menuScrollHeight = menuElement?.scrollHeight ?? menuRect?.height ?? 0
      const availableBelow = Math.max(viewportHeight - anchorRect.bottom - offset - minViewportMargin, 0)
      const availableAbove = Math.max(anchorRect.top - offset - minViewportMargin, 0)
      const shouldOpenAbove =
        preferredPlacement === 'above'
          ? availableAbove >= menuScrollHeight && availableAbove >= availableBelow
          : availableBelow < menuScrollHeight && availableAbove > availableBelow
      const maxHeight = Math.max(shouldOpenAbove ? availableAbove : availableBelow, 0)
      const unclampedLeft = anchorRect.left
      const maxLeft = Math.max(viewportWidth - menuWidth - minViewportMargin, minViewportMargin)
      const left = Math.min(Math.max(unclampedLeft, minViewportMargin), maxLeft)
      // The first layout pass can still have a zero offsetHeight because the
      // previous hidden style had maxHeight: 0. The intrinsic height is already
      // available and avoids a second visible jump after the menu becomes visible.
      const menuHeight = Math.min(menuScrollHeight, maxHeight)
      const top = shouldOpenAbove
        ? Math.max(minViewportMargin, anchorRect.top - menuHeight - offset)
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

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [anchorRef, isOpen, matchAnchorWidth, menuRef, minViewportMargin, offset, preferredPlacement])

  const resolvedMenuStyle: CSSProperties = {
    ...menuStyle,
    visibility: isOpen && isPositioned ? 'visible' : 'hidden',
  }
  return resolvedMenuStyle
}
