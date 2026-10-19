import {
  useEffect,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'

interface DropdownPopoverProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  isOpen: boolean
  onClose: () => void
  children: ReactNode
  matchAnchorWidth?: boolean
  preferredPlacement?: 'above' | 'below'
}

export function DropdownPopover({
  anchorRef,
  panelRef,
  isOpen,
  onClose,
  children,
  matchAnchorWidth = true,
  preferredPlacement = 'below',
  className,
  ...props
}: DropdownPopoverProps) {
  const style = useFloatingMenuPosition({
    anchorRef,
    menuRef: panelRef,
    isOpen,
    matchAnchorWidth,
    preferredPlacement,
  })
  useEffect(() => {
    if (!isOpen) {
      return
    }
    function handleOutsideClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !anchorRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      ) {
        onClose()
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [anchorRef, panelRef, isOpen, onClose])

  if (!isOpen) {
    return null
  }
  return createPortal(
    <div
      {...props}
      ref={panelRef}
      data-floating-menu-root="true"
      className={[
        'fixed z-[1500] overflow-y-auto rounded-xl border border-border bg-surface-raised shadow-soft',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {children}
    </div>,
    document.body,
  )
}
