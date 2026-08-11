import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  resolveWorkspaceMonacoDiffCopyMenuPosition,
  type WorkspaceMonacoDiffCopyMenuDimensions,
  type WorkspaceMonacoDiffCopyMenuState,
} from './workspaceMonacoDiffCopy'

interface WorkspaceMonacoDiffCopyMenuProps {
  menuState: WorkspaceMonacoDiffCopyMenuState | null
  onClose: () => void
  onCopy: (text: string) => void
}

export function WorkspaceMonacoDiffCopyMenu({
  menuState,
  onClose,
  onCopy,
}: WorkspaceMonacoDiffCopyMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [dimensions, setDimensions] = useState<WorkspaceMonacoDiffCopyMenuDimensions | null>(null)

  useLayoutEffect(() => {
    if (!menuState) {
      setDimensions(null)
      return
    }

    const menu = menuRef.current
    if (!menu) {
      return
    }

    const rect = menu.getBoundingClientRect()
    setDimensions({ height: rect.height, width: rect.width })
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [menuState])

  const position = useMemo(() => {
    if (!menuState || typeof window === 'undefined') {
      return { left: 0, top: 0 }
    }

    return resolveWorkspaceMonacoDiffCopyMenuPosition(
      menuState.position,
      { height: window.innerHeight, width: window.innerWidth },
      dimensions,
    )
  }, [dimensions, menuState])

  if (!menuState || typeof document === 'undefined') {
    return null
  }

  const copyHunkLabel = menuState.isDeletion
    ? menuState.originalLineCount > 1 ? 'Copy deleted lines' : 'Copy deleted line'
    : menuState.originalLineCount > 1 ? 'Copy changed lines' : 'Copy changed line'
  const copyLineLabel = menuState.isDeletion
    ? `Copy deleted line (${menuState.lineNumber})`
    : `Copy changed line (${menuState.lineNumber})`

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    const menuItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    )
    if (menuItems.length === 0) {
      return
    }

    event.preventDefault()
    const focusedIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (focusedIndex + direction + menuItems.length) % menuItems.length
    menuItems[nextIndex]?.focus({ preventScroll: true })
  }

  return createPortal(
    <div
      ref={menuRef}
      aria-label="Diff copy actions"
      className="fixed z-[1300] flex min-w-[240px] flex-col gap-1 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
      data-floating-menu-root="true"
      data-workspace-diff-copy-menu="true"
      onKeyDown={handleKeyDown}
      role="menu"
      style={position}
    >
      <button
        className="flex h-9 w-full items-center rounded-lg px-3 text-left text-sm text-foreground outline-none transition-colors hover:bg-surface-muted focus:bg-surface-muted"
        onClick={() => onCopy(menuState.hunkText)}
        onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
        role="menuitem"
        type="button"
      >
        {copyHunkLabel}
      </button>
      {menuState.originalLineCount > 1 ? (
        <button
          className="flex h-9 w-full items-center rounded-lg px-3 text-left text-sm text-foreground outline-none transition-colors hover:bg-surface-muted focus:bg-surface-muted"
          onClick={() => onCopy(menuState.lineText)}
          onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
          role="menuitem"
          type="button"
        >
          {copyLineLabel}
        </button>
      ) : null}
    </div>,
    document.body,
  )
}
