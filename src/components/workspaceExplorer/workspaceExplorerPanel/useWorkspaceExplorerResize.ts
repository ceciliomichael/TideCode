import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { getMaxDiffPanelWidth, getMinDiffPanelWidth } from '../../../lib/diffPanelSizing'
import { getMinWorkspaceExplorerWidth, getMaxWorkspaceExplorerWidth } from '../../../lib/workspaceExplorerSizing'
import { clampWorkspacePanelWidth } from '../../../lib/workspacePanelSizing'

interface UseWorkspaceExplorerResizeOptions {
  isOpen: boolean
  onWidthChange: (nextWidth: number) => void
  onWidthCommit: (nextWidth: number) => void
  presentation: 'desktop' | 'mobile'
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
  presentation,
  width,
}: UseWorkspaceExplorerResizeOptions) {
  const panelRef = useRef<HTMLElement | null>(null)
  const widthRef = useRef(width)
  const [renderedWidth, setRenderedWidth] = useState(width)
  const [isResizing, setIsResizing] = useState(false)
  const dragStateRef = useRef<WorkspaceExplorerResizeDragState | null>(null)
  const onWidthChangeRef = useRef(onWidthChange)
  const onWidthCommitRef = useRef(onWidthCommit)

  function clampWidth(nextWidth: number) {
    const panel = panelRef.current
    if (!panel) {
      return nextWidth
    }
    const parentWidth = panel.parentElement?.clientWidth ?? window.innerWidth
    const minimumWidth = presentation === 'mobile'
      ? getMinWorkspaceExplorerWidth(parentWidth)
      : getMinDiffPanelWidth(parentWidth)
    const maximumWidth = presentation === 'mobile'
      ? getMaxWorkspaceExplorerWidth(parentWidth)
      : getMaxDiffPanelWidth(parentWidth)
    return clampWorkspacePanelWidth(panel, nextWidth, minimumWidth, maximumWidth)
  }

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange
    onWidthCommitRef.current = onWidthCommit
  }, [onWidthChange, onWidthCommit])

  useLayoutEffect(() => {
    if (isResizing) {
      return
    }
    setRenderedWidth(width)
    widthRef.current = width
  }, [isResizing, width])

  useLayoutEffect(() => {
    if (!isOpen || isResizing) {
      return
    }

    function handleWindowResize() {
      const clampedWidth = clampWidth(renderedWidth)
      if (clampedWidth !== renderedWidth) {
        setRenderedWidth(clampedWidth)
        onWidthChange(clampedWidth)
      }
    }

    handleWindowResize()
    const observer = new ResizeObserver(handleWindowResize)
    if (panelRef.current?.parentElement) {
      observer.observe(panelRef.current.parentElement)
      const chat = panelRef.current.parentElement.querySelector('[data-chat-panel]')
      if (chat) {
        observer.observe(chat)
      }
    }
    window.addEventListener('resize', handleWindowResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [isOpen, isResizing, onWidthChange, presentation, renderedWidth])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      const nextWidth = clampWidth(dragState.startWidth - (event.clientX - dragState.startX))
      widthRef.current = nextWidth
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

      const committedWidth = widthRef.current
      setRenderedWidth(committedWidth)
      onWidthChangeRef.current(committedWidth)
      onWidthCommitRef.current(committedWidth)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      dragStateRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [presentation])

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isOpen || event.button !== 0) {
        return
      }

      widthRef.current = renderedWidth
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
    panelRef,
    handleResizePointerDown,
    isResizing,
    renderedWidth,
  }
}
