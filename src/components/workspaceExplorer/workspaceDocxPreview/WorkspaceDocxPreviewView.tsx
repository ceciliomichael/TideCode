import { ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { requestDocxPreviewRender } from '../../../lib/docxPreviewRenderCache'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { useWorkspaceDocumentCanvasInteraction } from '../workspaceDocumentPreview/useWorkspaceDocumentCanvasInteraction'
import { Tooltip } from '../../Tooltip'

interface WorkspaceDocxPreviewViewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
}

const MIN_ZOOM = 0.65
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.15

function getPathSegments(relativePath: string) {
  return relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

export const WorkspaceDocxPreviewView = memo(function WorkspaceDocxPreviewView({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
}: WorkspaceDocxPreviewViewProps) {
  const [isRendering, setIsRendering] = useState(Boolean(previewDataUrl) && !previewError)
  const [errorMessage, setErrorMessage] = useState<string | null>(
    previewError ? toUserFacingErrorMessage(previewError, `TideCode could not open ${fileName}.`) : null,
  )
  const [pageCount, setPageCount] = useState(0)
  const [renderedSize, setRenderedSize] = useState({ height: 0, width: 0 })
  const renderedDocumentRef = useRef<HTMLDivElement | null>(null)
  const renderedStyleRef = useRef<HTMLDivElement | null>(null)
  const {
    changeZoom,
    handleViewportPointerDown,
    handleViewportPointerEnd,
    handleViewportPointerMove,
    handleViewportWheel,
    isPanning,
    resetZoom,
    viewportRef,
    zoom,
  } = useWorkspaceDocumentCanvasInteraction({ maxZoom: MAX_ZOOM, minZoom: MIN_ZOOM })
  const pathSegments = useMemo(() => getPathSegments(relativePath), [relativePath])

  useEffect(() => {
    let isDisposed = false

    setRenderedSize({ height: 0, width: 0 })
    setPageCount(0)
    resetZoom()
    setErrorMessage(
      previewError ? toUserFacingErrorMessage(previewError, `TideCode could not open ${fileName}.`) : null,
    )
    setIsRendering(Boolean(previewDataUrl) && !previewError)

    const renderedDocument = renderedDocumentRef.current
    const renderedStyle = renderedStyleRef.current
    renderedDocument?.replaceChildren()
    renderedStyle?.replaceChildren()
    if (!previewDataUrl || previewError || !renderedDocument || !renderedStyle) {
      return () => {
        isDisposed = true
      }
    }

    try {
      void requestDocxPreviewRender(previewDataUrl)
        .then((snapshot) => {
          if (isDisposed) {
            return
          }
          renderedStyle.innerHTML = snapshot.stylesHtml
          renderedDocument.innerHTML = snapshot.documentHtml
          setRenderedSize({ height: snapshot.height, width: snapshot.width })
          setPageCount(snapshot.pageCount)
          setIsRendering(false)
        })
        .catch((error: unknown) => {
          if (isDisposed) {
            return
          }
          renderedDocument.replaceChildren()
          renderedStyle.replaceChildren()
          setIsRendering(false)
          setErrorMessage(toUserFacingErrorMessage(error, 'This DOCX could not be opened.'))
        })
    } catch (error: unknown) {
      setIsRendering(false)
      setErrorMessage(toUserFacingErrorMessage(error, 'This DOCX preview data was invalid.'))
    }

    return () => {
      isDisposed = true
    }
  }, [fileName, previewDataUrl, previewError, resetZoom])

  const previewUnavailable = !previewDataUrl || Boolean(errorMessage)
  const hasRenderedDocument = renderedSize.width > 0 && renderedSize.height > 0

  return (
    <div className="workspace-docx-preview flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
          {pathSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
              {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
              <Tooltip content={relativePath} side="bottom" noWrap triggerClassName="min-w-0">
                <span className="truncate">{segment}</span>
              </Tooltip>
            </span>
          ))}
        </div>
        {hasRenderedDocument && !previewUnavailable ? (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-[12px] text-subtle-foreground">
              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
            </span>
            <Tooltip content="Zoom out" side="bottom" noWrap>
              <button
                type="button"
                onClick={() => changeZoom(-ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-subtle-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
            </Tooltip>
            <span className="w-11 text-center text-[12px] text-subtle-foreground">{Math.round(zoom * 100)}%</span>
            <Tooltip content="Zoom in" side="bottom" noWrap>
              <button
                type="button"
                onClick={() => changeZoom(ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-subtle-foreground transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>
      <div ref={renderedStyleRef} className="docx-rendered-styles" aria-hidden="true" />
      <div
        ref={viewportRef}
        onPointerCancel={handleViewportPointerEnd}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerEnd}
        onWheel={handleViewportWheel}
        className={`relative min-h-0 flex-1 overflow-auto bg-surface ${isPanning ? 'cursor-grabbing select-none' : 'cursor-default'}`}
      >
        <div className="docx-canvas workspace-document-page-stack">
          <div
            className="docx-render-size relative shrink-0"
            style={{
              height: `${Math.max(1, renderedSize.height * zoom)}px`,
              width: `${Math.max(1, renderedSize.width * zoom)}px`,
            }}
          >
            <div
              ref={renderedDocumentRef}
              className="docx-rendered-document"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: renderedSize.width > 0 ? `${renderedSize.width}px` : undefined,
              }}
            />
          </div>
        </div>
        {isRendering ? (
          <div className="absolute inset-0 flex min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
            Loading {fileName}...
          </div>
        ) : previewUnavailable ? (
          <div className="absolute inset-0 flex min-h-[200px] items-center justify-center px-4">
            <div className="max-w-lg text-center">
              <div className="text-sm font-medium text-foreground">DOCX preview unavailable</div>
              <p className="mt-2 text-sm leading-6 text-subtle-foreground">
                {errorMessage ?? `TideCode could not open ${fileName}.`}
              </p>
            </div>
          </div>
        ) : !hasRenderedDocument ? (
          <div className="absolute inset-0 flex min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
            This DOCX has no renderable content.
          </div>
        ) : null}
      </div>
    </div>
  )
})
