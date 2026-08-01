import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { getMaxDiffPanelWidth, getMinDiffPanelWidth } from '../../lib/diffPanelSizing'
import {
  clampSourceControlHistoryHeight,
  getDefaultSourceControlHistoryHeight,
} from '../../lib/sourceControlSizing'

interface SourceControlPanelSizingInput {
  isHistorySectionOpen: boolean
  isOpen: boolean
  onWidthChange: (nextWidth: number) => void
  onWidthCommit?: (nextWidth: number) => void
  shouldUseSplitLayout: boolean
  width: number
}

export function useSourceControlPanelSizing({
  isHistorySectionOpen,
  isOpen,
  onWidthChange,
  onWidthCommit,
  shouldUseSplitLayout,
  width,
}: SourceControlPanelSizingInput) {
    const panelRef = useRef<HTMLDivElement | null>(null)
    const panelBodyRef = useRef<HTMLDivElement | null>(null)
    const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
    const resizeAnimationFrameRef = useRef<number | null>(null)
    const historyResizeStateRef = useRef<{
      containerHeight: number
      pointerId: number
      startHeight: number
      startY: number
    } | null>(null)
    const widthRef = useRef(width)
    const onWidthChangeRef = useRef(onWidthChange)
    const onWidthCommitRef = useRef(onWidthCommit)
    const [isResizing, setIsResizing] = useState(false)
    const [renderedWidth, setRenderedWidth] = useState(width)
    const [isHistoryResizing, setIsHistoryResizing] = useState(false)
    const [historyHeight, setHistoryHeight] = useState<number | null>(null)

    useEffect(() => {
      widthRef.current = width
    }, [width])
  
    useEffect(() => {
      if (isResizing) {
        return
      }
      setRenderedWidth(width)
    }, [isResizing, width])
  
    useEffect(() => {
      onWidthChangeRef.current = onWidthChange
    }, [onWidthChange])
  
    useEffect(() => {
      onWidthCommitRef.current = onWidthCommit
    }, [onWidthCommit])
  
    useEffect(() => {
      if (!isOpen) {
        return
      }
  
      function clampPanelWidth() {
        if (dragStateRef.current) {
          return
        }
        const parentWidth = panelRef.current?.parentElement?.clientWidth
        if (!parentWidth) {
          return
        }
  
        const clampedWidth = Math.min(getMaxDiffPanelWidth(parentWidth), Math.max(getMinDiffPanelWidth(parentWidth), renderedWidth))
        if (clampedWidth !== renderedWidth) {
          setRenderedWidth(clampedWidth)
          onWidthChangeRef.current(clampedWidth)
        }
      }
  
      clampPanelWidth()
      window.addEventListener('resize', clampPanelWidth)
      return () => window.removeEventListener('resize', clampPanelWidth)
    }, [isOpen, renderedWidth])
  
    useEffect(() => {
      function handlePointerMove(event: PointerEvent) {
        const dragState = dragStateRef.current
        const parentWidth = panelRef.current?.parentElement?.clientWidth
        if (!dragState || !parentWidth) {
          return
        }
  
        const nextWidth = dragState.startWidth - (event.clientX - dragState.startX)
        const clampedWidth = Math.min(
          getMaxDiffPanelWidth(parentWidth),
          Math.max(getMinDiffPanelWidth(parentWidth), Math.round(nextWidth)),
        )
        widthRef.current = clampedWidth
        if (resizeAnimationFrameRef.current !== null) {
          return
        }
  
        resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
          resizeAnimationFrameRef.current = null
          setRenderedWidth(widthRef.current)
          if (panelRef.current) {
            panelRef.current.style.width = `${widthRef.current}px`
          }
        })
      }
  
      function handlePointerUp(event: PointerEvent) {
        if (dragStateRef.current?.pointerId !== event.pointerId) {
          return
        }
  
        dragStateRef.current = null
        if (resizeAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeAnimationFrameRef.current)
          resizeAnimationFrameRef.current = null
        }
        setRenderedWidth(widthRef.current)
        setIsResizing(false)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        onWidthChangeRef.current(widthRef.current)
        onWidthCommitRef.current?.(widthRef.current)
      }
  
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
  
      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        if (resizeAnimationFrameRef.current !== null) {
          window.cancelAnimationFrame(resizeAnimationFrameRef.current)
          resizeAnimationFrameRef.current = null
        }
        dragStateRef.current = null
        setIsResizing(false)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    }, [])
  
    useEffect(() => {
      function handleHistoryPointerMove(event: PointerEvent) {
        const resizeState = historyResizeStateRef.current
        if (!resizeState) {
          return
        }
  
        const nextHeight = clampSourceControlHistoryHeight(
          resizeState.startHeight + (resizeState.startY - event.clientY),
          resizeState.containerHeight,
        )
        setHistoryHeight(nextHeight)
      }
  
      function handleHistoryPointerUp(event: PointerEvent) {
        if (historyResizeStateRef.current?.pointerId !== event.pointerId) {
          return
        }
  
        historyResizeStateRef.current = null
        setIsHistoryResizing(false)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
  
      window.addEventListener('pointermove', handleHistoryPointerMove)
      window.addEventListener('pointerup', handleHistoryPointerUp)
  
      return () => {
        window.removeEventListener('pointermove', handleHistoryPointerMove)
        window.removeEventListener('pointerup', handleHistoryPointerUp)
        historyResizeStateRef.current = null
        setIsHistoryResizing(false)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    }, [])
  
    useLayoutEffect(() => {
      if (!shouldUseSplitLayout || historyHeight !== null) {
        return
      }
  
      const containerHeight = panelBodyRef.current?.clientHeight
      if (!containerHeight) {
        return
      }
  
      setHistoryHeight(getDefaultSourceControlHistoryHeight(containerHeight))
    }, [historyHeight, shouldUseSplitLayout])
  
    useEffect(() => {
      const panelBody = panelBodyRef.current
      if (!panelBody) {
        return
      }
  
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const containerHeight = entry.contentRect.height
          setHistoryHeight((currentValue) => {
            if (currentValue === null || !shouldUseSplitLayout) return currentValue
            const clamped = clampSourceControlHistoryHeight(currentValue, containerHeight)
            return clamped !== currentValue ? clamped : currentValue
          })
        }
      })
  
      observer.observe(panelBody)
      return () => observer.disconnect()
    }, [shouldUseSplitLayout])

    function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0) {
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
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
    }
  
    function handleHistoryResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0) {
        return
      }
  
      if (!isHistorySectionOpen) {
        return
      }
  
      const containerHeight = panelBodyRef.current?.clientHeight
      if (!containerHeight) {
        return
      }
  
      const startHeight = historyHeight ?? getDefaultSourceControlHistoryHeight(containerHeight)
      historyResizeStateRef.current = {
        containerHeight,
        pointerId: event.pointerId,
        startHeight,
        startY: event.clientY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      setHistoryHeight(startHeight)
      setIsHistoryResizing(true)
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'row-resize'
    }

  return {
    handleHistoryResizePointerDown,
    handleResizePointerDown,
    historyHeight,
    isHistoryResizing,
    panelBodyRef,
    panelRef,
    renderedWidth,
  }
}
