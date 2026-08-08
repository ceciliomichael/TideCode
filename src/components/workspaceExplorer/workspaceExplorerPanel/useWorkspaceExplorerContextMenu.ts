import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import type {
  WorkspaceExplorerContextMenuDimensions,
  WorkspaceExplorerContextMenuState,
} from './workspaceExplorerPanelTypes'
import { ROOT_DIRECTORY_KEY, getWorkspaceExplorerContextMenuStyle } from './workspaceExplorerPanelUtils'
import { getSelectionDirectoryPath } from './workspaceExplorerSelectionUtils'

interface UseWorkspaceExplorerContextMenuOptions {
  isWorkspaceConfigured: boolean
  selectedEntryPaths: Set<string>
  selectionAnchorEntryPathRef: MutableRefObject<string | null>
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>
  setSelectionDirectoryPath: Dispatch<SetStateAction<string>>
  treeContainerRef: RefObject<HTMLDivElement>
}

export function useWorkspaceExplorerContextMenu({
  isWorkspaceConfigured,
  selectedEntryPaths,
  selectionAnchorEntryPathRef,
  setSelectedEntryPaths,
  setSelectionDirectoryPath,
  treeContainerRef,
}: UseWorkspaceExplorerContextMenuOptions) {
  const [contextMenuState, setContextMenuState] = useState<WorkspaceExplorerContextMenuState | null>(null)
  const [contextMenuDimensions, setContextMenuDimensions] = useState<WorkspaceExplorerContextMenuDimensions | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const wasContextMenuOpenRef = useRef(false)

  const closeContextMenu = useCallback(() => {
    if (wasContextMenuOpenRef.current) {
      wasContextMenuOpenRef.current = false
      treeContainerRef.current?.focus({ preventScroll: true })
    }
    setContextMenuState(null)
  }, [treeContainerRef])

  const contextMenuStyle = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        left: 0,
        top: 0,
        visibility: 'hidden',
      } satisfies CSSProperties
    }

    return getWorkspaceExplorerContextMenuStyle(contextMenuState, {
      height: window.innerHeight,
      width: window.innerWidth,
    }, contextMenuDimensions)
  }, [contextMenuDimensions, contextMenuState])

  useLayoutEffect(() => {
    if (!contextMenuState) {
      setContextMenuDimensions(null)
      return
    }

    const contextMenuElement = contextMenuRef.current
    if (!contextMenuElement) {
      return
    }

    const updateContextMenuDimensions = () => {
      const nextRect = contextMenuElement.getBoundingClientRect()
      setContextMenuDimensions((currentDimensions) => {
        if (
          currentDimensions?.width === nextRect.width &&
          currentDimensions?.height === nextRect.height
        ) {
          return currentDimensions
        }

        return {
          height: nextRect.height,
          width: nextRect.width,
        }
      })
    }

    updateContextMenuDimensions()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver(updateContextMenuDimensions)
    resizeObserver.observe(contextMenuElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [contextMenuState])

  useEffect(() => {
    if (!contextMenuState) {
      return
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (contextMenuRef.current?.contains(target)) {
        return
      }
      closeContextMenu()
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    document.addEventListener('keydown', handleDocumentKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown)
      document.removeEventListener('keydown', handleDocumentKeyDown)
    }
  }, [closeContextMenu, contextMenuState])

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, targetEntry: WorkspaceExplorerEntry | null) => {
      if (!isWorkspaceConfigured) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      wasContextMenuOpenRef.current = true
      if (targetEntry) {
        const nextSelectionDirectoryPath = getSelectionDirectoryPath(targetEntry)
        if (!selectedEntryPaths.has(targetEntry.relativePath)) {
          setSelectionDirectoryPath(nextSelectionDirectoryPath)
          setSelectedEntryPaths(new Set([targetEntry.relativePath]))
          selectionAnchorEntryPathRef.current = targetEntry.relativePath
        }
      } else {
        setSelectionDirectoryPath(ROOT_DIRECTORY_KEY)
        setSelectedEntryPaths(new Set())
        selectionAnchorEntryPathRef.current = null
      }
      setContextMenuState({
        position: {
          x: event.clientX,
          y: event.clientY,
        },
        targetEntry,
      })
    },
    [
      isWorkspaceConfigured,
      selectedEntryPaths,
      selectionAnchorEntryPathRef,
      setSelectedEntryPaths,
      setSelectionDirectoryPath,
    ],
  )

  return {
    closeContextMenu,
    contextMenuRef,
    contextMenuState,
    contextMenuStyle,
    openContextMenu,
  }
}
