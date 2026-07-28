import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

interface UseFloatingMenuPositionInput {
  anchorRef: RefObject<HTMLElement | null>
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
  isOpen,
  matchAnchorWidth = true,
  menuRef,
  minViewportMargin = DEFAULT_VIEWPORT_MARGIN,
  offset = DEFAULT_OFFSET,
  preferredPlacement = 'below',
}: UseFloatingMenuPositionInput) {
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    left: 0,
    maxHeight: 0,
    minWidth: 0,
    top: 0,
    visibility: 'hidden',
  })

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    function updateMenuPosition() {
      const anchorElement = anchorRef.current
      const menuElement = menuRef.current
      const anchorRect = anchorElement?.getBoundingClientRect()
      const menuRect = menuElement?.getBoundingClientRect()

      if (!anchorRect) {
        return
      }

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const menuWidth = menuRect?.width ?? anchorRect.width
      // Use scrollHeight (intrinsic content height) only for deciding which side
      // to open on, but use offsetHeight (the actual clamped rendered height) for
      // the final `top` calculation so a 1-result menu doesn't jump too far above.
      const menuScrollHeight = menuElement?.scrollHeight ?? menuRect?.height ?? 0
      const menuRenderedHeight = menuElement?.offsetHeight ?? menuRect?.height ?? 0
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
      // Use the actual rendered height (offsetHeight) for the top offset so the
      // menu sits flush against the anchor regardless of how many results there are.
      const top = shouldOpenAbove
        ? Math.max(minViewportMargin, anchorRect.top - Math.min(menuRenderedHeight, maxHeight) - offset)
        : anchorRect.bottom + offset

      setMenuStyle({
        left,
        maxHeight,
        minWidth: matchAnchorWidth ? anchorRect.width : undefined,
        top,
        visibility: 'visible',
      })
    }

    updateMenuPosition()
    const animationFrameId = window.requestAnimationFrame(updateMenuPosition)
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
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [anchorRef, isOpen, matchAnchorWidth, menuRef, minViewportMargin, offset, preferredPlacement])

  return menuStyle
}
