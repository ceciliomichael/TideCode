import { ChevronRight } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getImagePreviewCanvasSize,
  getImagePreviewFitScale,
  type ImagePreviewSize,
} from './imagePreviewSizing'
import { useWorkspaceDocumentCanvasInteraction } from '../workspaceDocumentPreview/useWorkspaceDocumentCanvasInteraction'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { Tooltip } from '../../Tooltip'

interface WorkspaceImagePreviewViewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
}

function getPathSegments(relativePath: string) {
  return relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 5

function getViewportSize(viewport: HTMLDivElement): ImagePreviewSize {
  return {
    height: viewport.clientHeight,
    width: viewport.clientWidth,
  }
}

export const WorkspaceImagePreviewView = memo(function WorkspaceImagePreviewView({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
}: WorkspaceImagePreviewViewProps) {
  const [hasError, setHasError] = useState(false)
  const [imageSize, setImageSize] = useState<ImagePreviewSize | null>(null)
  const [viewportSize, setViewportSize] = useState<ImagePreviewSize>({ height: 0, width: 0 })
  const imageRef = useRef<HTMLImageElement | null>(null)
  const {
    handleViewportPointerDown,
    handleViewportPointerEnd,
    handleViewportPointerMove,
    handleViewportWheel,
    isPanning,
    resetZoom,
    viewportRef,
    zoom,
  } = useWorkspaceDocumentCanvasInteraction({
    maxZoom: MAX_ZOOM,
    minZoom: MIN_ZOOM,
  })
  const pathSegments = useMemo(() => getPathSegments(relativePath), [relativePath])
  const previewErrorMessage = previewError
    ? toUserFacingErrorMessage(previewError, `TideCode could not render ${fileName}.`)
    : null

  const fitScale = imageSize ? getImagePreviewFitScale(imageSize, viewportSize) : 1
  const canvasSize = imageSize
    ? getImagePreviewCanvasSize(imageSize, viewportSize, zoom, fitScale)
    : null

  const updateLoadedImageSize = useCallback(() => {
    const image = imageRef.current
    const viewport = viewportRef.current
    if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return
    }

    if (viewport) {
      setViewportSize(getViewportSize(viewport))
    }
    setImageSize({ height: image.naturalHeight, width: image.naturalWidth })
  }, [viewportRef])

  useEffect(() => {
    setHasError(false)
    setImageSize(null)
    resetZoom()
    viewportRef.current?.scrollTo({ left: 0, top: 0 })
    queueMicrotask(updateLoadedImageSize)
  }, [previewDataUrl, resetZoom, updateLoadedImageSize])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const updateViewportSize = () => {
      setViewportSize(getViewportSize(viewport))
    }

    updateViewportSize()
    const resizeObserver = new ResizeObserver(updateViewportSize)
    resizeObserver.observe(viewport)

    return () => resizeObserver.disconnect()
  }, [previewDataUrl, viewportRef])

  const imageUnavailable = !previewDataUrl || hasError

  return (
    <div className="workspace-image-preview flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-7 shrink-0 items-center bg-surface px-2">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
          {pathSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
              {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
              <Tooltip content={relativePath} side="bottom" noWrap triggerClassName="min-w-0">
                <span className="truncate">{segment}</span>
              </Tooltip>
            </span>
          ))}
        </div>
      </div>
      <div
        ref={viewportRef}
        onPointerCancel={handleViewportPointerEnd}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerEnd}
        onWheel={handleViewportWheel}
        className={`min-h-0 flex-1 overflow-auto bg-surface ${isPanning ? 'cursor-grabbing select-none' : 'cursor-default'}`}
      >
        <div
          className="flex items-center justify-center p-4"
          style={
            canvasSize
              ? {
                  height: `${canvasSize.height}px`,
                  width: `${canvasSize.width}px`,
                }
              : { minHeight: '100%', minWidth: '100%' }
          }
        >
          {imageUnavailable ? (
            <div className="max-w-lg text-center">
              <div className="text-sm font-medium text-foreground">Image preview unavailable</div>
              <p className="mt-2 text-sm leading-6 text-subtle-foreground">
                {previewErrorMessage ?? `TideCode could not render ${fileName}. You can still keep the file in your workspace.`}
              </p>
            </div>
          ) : (
            <img
              alt={fileName}
              className={`block object-contain ${zoom === 1 ? 'max-h-full max-w-full' : 'max-w-none'}`}
              draggable={false}
              ref={imageRef}
              src={previewDataUrl}
              style={
                canvasSize
                  ? {
                      height: `${canvasSize.imageHeight}px`,
                      width: `${canvasSize.imageWidth}px`,
                    }
                  : undefined
              }
              onLoad={updateLoadedImageSize}
              onError={() => setHasError(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
})
