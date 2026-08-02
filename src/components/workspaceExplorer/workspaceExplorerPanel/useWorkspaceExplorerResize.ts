import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { clampWorkspaceExplorerWidth } from '../../../lib/workspaceExplorerSizing'

interface UseWorkspaceExplorerResizeOptions {
  isOpen: boolean
  onWidthChange: (nextWidth: number) => void
  onWidthCommit: (nextWidth: number) => void
  width: number
}

interface WorkspaceExplorerResizeDragState {
  pointerId: number
  startWidth: number
  startX: number
}

export function useWorkspaceExplorerResize({
  isOpen,
  onWidthChange,
  onWidthCommit,
  width,
}: UseWorkspaceExplorerResizeOptions) {
  const [renderedWidth, setRenderedWidth] = useState(width)
  const [isResizing, setIsResizing] = useState(false)
  const dragStateRef = useRef<WorkspaceExplorerResizeDragState | null>(null)
  const onWidthChangeRef = useRef(onWidthChange)
  const onWidthCommitRef = useRef(onWidthCommit)

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange
    onWidthCommitRef.current = onWidthCommit
  }, [onWidthChange, onWidthCommit])

  useLayoutEffect(() => {
    if (isResizing) {
      return
    }
    setRenderedWidth(width)
  }, [isResizing, width])

  useLayoutEffect(() => {
    if (!isOpen || isResizing) {
      return
    }

    function handleWindowResize() {
      const clampedWidth = clampWorkspaceExplorerWidth(renderedWidth, window.innerWidth)
      if (clampedWidth !== renderedWidth) {
        setRenderedWidth(clampedWidth)
        onWidthChange(clampedWidth)
      }
    }

    handleWindowResize()
    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [isOpen, isResizing, onWidthChange, renderedWidth])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      if (!dragState) {
        return
      }

      const nextWidth = clampWorkspaceExplorerWidth(
        dragState.startWidth - (event.clientX - dragState.startX),
        window.innerWidth,
      )
      setRenderedWidth(nextWidth)
    }

    function handlePointerUp(event: PointerEvent) {
      if (dragStateRef.current?.pointerId !== event.pointerId) {
        return
      }

      const dragState = dragStateRef.current
      dragStateRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (!dragState) {
        return
      }

      const committedWidth = clampWorkspaceExplorerWidth(
        dragState.startWidth - (event.clientX - dragState.startX),
        window.innerWidth,
      )
      setRenderedWidth(committedWidth)
      onWidthChangeRef.current(committedWidth)
      onWidthCommitRef.current(committedWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      dragStateRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isOpen || event.button !== 0) {
        return
      }

      dragStateRef.current = {
        pointerId: event.pointerId,
        startWidth: renderedWidth,
        startX: event.clientX,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [isOpen, renderedWidth],
  )

  return {
    handleResizePointerDown,
    isResizing,
    renderedWidth,
  }
}
