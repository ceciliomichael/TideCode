import { useCallback, useEffect, useRef, type DragEvent as ReactDragEvent, type RefObject } from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import {
  getDragScrollVelocity,
  isPointerInVerticalScrollbarGutter,
  scrollToDragScrollbarPosition,
} from './workspaceExplorerDragUtils'

interface UseWorkspaceExplorerDragScrollOptions {
  draggedEntryRef: RefObject<WorkspaceExplorerEntry | null>
}

export function useWorkspaceExplorerDragScroll({ draggedEntryRef }: UseWorkspaceExplorerDragScrollOptions) {
  const treeContainerRef = useRef<HTMLDivElement | null>(null)
  const dragScrollAnimationFrameRef = useRef<number | null>(null)
  const dragScrollVelocityRef = useRef(0)

  const stopDragScroll = useCallback(() => {
    dragScrollVelocityRef.current = 0
    if (dragScrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragScrollAnimationFrameRef.current)
      dragScrollAnimationFrameRef.current = null
    }
  }, [])

  const runDragScrollFrame = useCallback(() => {
    const containerElement = treeContainerRef.current
    const velocity = dragScrollVelocityRef.current

    if (!containerElement || velocity === 0) {
      dragScrollAnimationFrameRef.current = null
      return
    }

    containerElement.scrollTop += velocity
    dragScrollAnimationFrameRef.current = window.requestAnimationFrame(runDragScrollFrame)
  }, [])

  const updateDragScroll = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const containerElement = treeContainerRef.current
    if (!containerElement) {
      stopDragScroll()
      return
    }

    dragScrollVelocityRef.current = getDragScrollVelocity(containerElement, event.clientY)
    if (dragScrollVelocityRef.current === 0) {
      stopDragScroll()
      return
    }

    if (dragScrollAnimationFrameRef.current === null) {
      dragScrollAnimationFrameRef.current = window.requestAnimationFrame(runDragScrollFrame)
    }
  }, [runDragScrollFrame, stopDragScroll])

  const handleExplorerDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!draggedEntryRef.current && !Array.from(event.dataTransfer.types).includes('Files')) {
      return
    }

    const containerElement = treeContainerRef.current
    if (containerElement && isPointerInVerticalScrollbarGutter(containerElement, event.clientX)) {
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'none'
      stopDragScroll()
      scrollToDragScrollbarPosition(containerElement, event.clientY)
      return
    }

    updateDragScroll(event)
  }, [draggedEntryRef, stopDragScroll, updateDragScroll])

  const handleExplorerDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    stopDragScroll()
  }, [stopDragScroll])

  const handleExplorerScrollbarDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!draggedEntryRef.current) {
      return
    }

    const containerElement = treeContainerRef.current
    if (!containerElement) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'none'
    stopDragScroll()
    scrollToDragScrollbarPosition(containerElement, event.clientY)
  }, [draggedEntryRef, stopDragScroll])

  useEffect(() => {
    return () => {
      stopDragScroll()
    }
  }, [stopDragScroll])

  return {
    handleExplorerDragLeave,
    handleExplorerDragOver,
    handleExplorerScrollbarDragOver,
    stopDragScroll,
    treeContainerRef,
    updateDragScroll,
  }
}
