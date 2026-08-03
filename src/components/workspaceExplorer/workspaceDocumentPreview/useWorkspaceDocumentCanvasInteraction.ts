import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'

interface WorkspaceDocumentCanvasInteractionOptions {
  maxZoom: number
  minZoom: number
}

interface DocumentPanState {
  lastClientX: number
  lastClientY: number
  pointerId: number
}

interface DocumentZoomAnchor {
  clientX: number
  clientY: number
  contentX: number
  contentY: number
  zoom: number
}

export function useWorkspaceDocumentCanvasInteraction({
  maxZoom,
  minZoom,
}: WorkspaceDocumentCanvasInteractionOptions) {
  const [zoom, setZoom] = useState(1)
  const [isPanning, setIsPanning] = useState(false)
  const zoomRef = useRef(1)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const panStateRef = useRef<DocumentPanState | null>(null)
  const zoomAnchorRef = useRef<DocumentZoomAnchor | null>(null)

  const resetZoom = useCallback(() => {
    zoomAnchorRef.current = null
    zoomRef.current = 1
    setZoom(1)
  }, [])

  const changeZoom = useCallback(
    (delta: number) => {
      setZoom((currentZoom) => {
        const nextZoom = Math.min(maxZoom, Math.max(minZoom, Number((currentZoom + delta).toFixed(2))))
        zoomRef.current = nextZoom
        return nextZoom
      })
    },
    [maxZoom, minZoom],
  )

  useEffect(() => {
    const zoomAnchor = zoomAnchorRef.current
    if (!zoomAnchor) {
      return
    }

    zoomAnchorRef.current = null
    let firstFrameId: number | null = null
    let secondFrameId: number | null = null

    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        const viewport = viewportRef.current
        if (!viewport) {
          return
        }

        const viewportRect = viewport.getBoundingClientRect()
        const zoomRatio = zoom / zoomAnchor.zoom
        viewport.scrollLeft = Math.max(
          0,
          zoomAnchor.contentX * zoomRatio - (zoomAnchor.clientX - viewportRect.left),
        )
        viewport.scrollTop = Math.max(0, zoomAnchor.contentY * zoomRatio - (zoomAnchor.clientY - viewportRect.top))
      })
    })

    return () => {
      if (firstFrameId !== null) {
        window.cancelAnimationFrame(firstFrameId)
      }
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId)
      }
    }
  }, [zoom])

  const handleViewportWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      return
    }

    event.preventDefault()
    const viewport = event.currentTarget
    const currentZoom = zoomRef.current
    const nextZoom = Math.min(
      maxZoom,
      Math.max(minZoom, Number((currentZoom * Math.exp(-event.deltaY * 0.002)).toFixed(2))),
    )
    if (nextZoom === currentZoom) {
      return
    }

    const viewportRect = viewport.getBoundingClientRect()
    zoomAnchorRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      contentX: event.clientX - viewportRect.left + viewport.scrollLeft,
      contentY: event.clientY - viewportRect.top + viewport.scrollTop,
      zoom: currentZoom,
    }
    zoomRef.current = nextZoom
    setZoom(nextZoom)
  }, [maxZoom, minZoom])

  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) {
      return
    }

    event.preventDefault()
    panStateRef.current = {
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      pointerId: event.pointerId,
    }
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handleViewportPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current
    if (!panState || panState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    event.currentTarget.scrollLeft -= event.clientX - panState.lastClientX
    event.currentTarget.scrollTop -= event.clientY - panState.lastClientY
    panState.lastClientX = event.clientX
    panState.lastClientY = event.clientY
  }, [])

  const handleViewportPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panStateRef.current?.pointerId !== event.pointerId) {
      return
    }

    panStateRef.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  return {
    changeZoom,
    handleViewportPointerDown,
    handleViewportPointerEnd,
    handleViewportPointerMove,
    handleViewportWheel,
    isPanning,
    resetZoom,
    viewportRef,
    zoom,
  }
}
