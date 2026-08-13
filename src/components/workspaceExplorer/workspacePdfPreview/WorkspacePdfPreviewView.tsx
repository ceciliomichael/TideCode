import { ChevronRight } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import {
  ensurePdfPageRender,
  PDF_PAGE_SCALE,
  PDF_PREFETCH_PAGE_LIMIT,
  requestPdfPreviewRender,
  type PdfPreviewRenderSnapshot,
} from '../../../lib/pdfPreviewRenderCache'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { useWorkspaceDocumentCanvasInteraction } from '../workspaceDocumentPreview/useWorkspaceDocumentCanvasInteraction'
import { WorkspacePdfPage } from './WorkspacePdfPage'
import { Tooltip } from '../../Tooltip'

interface WorkspacePdfPreviewViewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
}

const MIN_ZOOM = 0.65
const MAX_ZOOM = 2.5
function getPathSegments(relativePath: string) {
  return relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

export const WorkspacePdfPreviewView = memo(function WorkspacePdfPreviewView({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
}: WorkspacePdfPreviewViewProps) {
  const [previewSnapshot, setPreviewSnapshot] = useState<PdfPreviewRenderSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(previewDataUrl))
  const [errorMessage, setErrorMessage] = useState<string | null>(
    previewError ? toUserFacingErrorMessage(previewError, `TideCode could not open ${fileName}.`) : null,
  )
  const {
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
    setPreviewSnapshot(null)
    resetZoom()
    setErrorMessage(
      previewError ? toUserFacingErrorMessage(previewError, `TideCode could not open ${fileName}.`) : null,
    )
    setIsLoading(Boolean(previewDataUrl) && !previewError)

    if (!previewDataUrl || previewError) {
      return () => {
        isDisposed = true
      }
    }

    try {
      void requestPdfPreviewRender(previewDataUrl)
        .then((loadedSnapshot) => {
          if (isDisposed) {
            return
          }
          setPreviewSnapshot(loadedSnapshot)
          setIsLoading(false)
        })
        .catch((error: unknown) => {
          if (isDisposed) {
            return
          }
          setIsLoading(false)
          setErrorMessage(toUserFacingErrorMessage(error, 'This PDF could not be opened.'))
        })
    } catch (error: unknown) {
      setIsLoading(false)
      setErrorMessage(toUserFacingErrorMessage(error, 'This PDF preview data was invalid.'))
    }

    return () => {
      isDisposed = true
    }
  }, [fileName, previewDataUrl, previewError, resetZoom])

  const previewUnavailable = !previewDataUrl || Boolean(errorMessage)
  const pageRenderPromises = useMemo(() => {
    if (!previewSnapshot || !previewDataUrl) {
      return []
    }
    return previewSnapshot.pageLayouts.map((_, index) =>
      index < PDF_PREFETCH_PAGE_LIMIT ? ensurePdfPageRender(previewDataUrl, index + 1) : undefined,
    )
  }, [previewDataUrl, previewSnapshot])

  return (
    <div className="workspace-pdf-preview flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-7 shrink-0 items-center bg-surface px-2">
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
        {previewSnapshot ? (
          <span className="shrink-0 text-[12px] text-subtle-foreground">
            {previewSnapshot.pageLayouts.length} {previewSnapshot.pageLayouts.length === 1 ? 'page' : 'pages'}
          </span>
        ) : null}
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
        {isLoading ? (
          <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
            Loading {fileName}...
          </div>
        ) : previewUnavailable ? (
          <div className="flex h-full min-h-[200px] items-center justify-center px-4">
            <div className="max-w-lg text-center">
              <div className="text-sm font-medium text-foreground">PDF preview unavailable</div>
              <p className="mt-2 text-sm leading-6 text-subtle-foreground">
                {errorMessage ?? `TideCode could not open ${fileName}.`}
              </p>
            </div>
          </div>
        ) : previewSnapshot ? (
          <div className="workspace-document-page-stack">
            {previewSnapshot.pageLayouts.map((pageLayout, index) => (
              <WorkspacePdfPage
                key={`${previewSnapshot.documentProxy.fingerprints[0] ?? fileName}-${index + 1}`}
                cachedPageRender={pageRenderPromises[index]}
                documentProxy={previewSnapshot.documentProxy}
                pageNumber={index + 1}
                pageLayout={pageLayout}
                scale={PDF_PAGE_SCALE * zoom}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
})
