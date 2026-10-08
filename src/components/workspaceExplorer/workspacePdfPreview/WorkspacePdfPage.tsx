import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import {
  PDF_PAGE_SCALE,
  PDF_RENDER_RESOLUTION_SCALE,
  type PdfPageLayout,
  PDF_MAX_CANVAS_PIXELS,
} from '../../../lib/pdfPreviewRenderCache'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'

interface WorkspacePdfPageProps {
  documentProxy: PDFDocumentProxy
  viewportRef: RefObject<HTMLDivElement | null>
  pageNumber: number
  pageLayout: PdfPageLayout
  scale: number
}

async function renderPdfPage(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  isDisposed: () => boolean,
  registerTask: (task: RenderTask) => void,
) {
  const page: PDFPageProxy = await documentProxy.getPage(pageNumber)
  if (isDisposed()) {
    return null
  }

  const viewport = page.getViewport({ scale })
  const devicePixelRatio = Math.min(
    3,
    Math.max(window.devicePixelRatio || 1, PDF_RENDER_RESOLUTION_SCALE),
    Math.sqrt(PDF_MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
  )
  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) {
    throw new Error('The browser could not create a PDF canvas.')
  }

  canvas.width = Math.ceil(viewport.width * devicePixelRatio)
  canvas.height = Math.ceil(viewport.height * devicePixelRatio)
  canvas.style.width = `${Math.ceil(viewport.width)}px`
  canvas.style.height = `${Math.ceil(viewport.height)}px`
  canvasContext.setTransform(1, 0, 0, 1, 0, 0)

  const renderTask: RenderTask = page.render({
    canvas,
    canvasContext,
    transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
    viewport,
  })
  registerTask(renderTask)
  await renderTask.promise
  return renderTask
}

export const WorkspacePdfPage = memo(function WorkspacePdfPage({
  viewportRef,
  documentProxy,
  pageNumber,
  pageLayout,
  scale,
}: WorkspacePdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const [isNearViewport, setIsNearViewport] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      setIsNearViewport(entry.isIntersecting)
    }, { root: viewportRef.current, rootMargin: '400px' })
    observer.observe(container)
    return () => observer.disconnect()
  }, [viewportRef])

  useEffect(() => {
    let isDisposed = false
    setErrorMessage(null)
    renderTaskRef.current?.cancel()
    renderTaskRef.current = null

    const canvas = canvasRef.current
    if (!canvas || !isNearViewport) {
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      return () => {
        isDisposed = true
      }
    }

    const expectedWidth = Math.ceil(pageLayout.width * (scale / PDF_PAGE_SCALE))
    const expectedHeight = Math.ceil(pageLayout.height * (scale / PDF_PAGE_SCALE))
    canvas.style.width = `${expectedWidth}px`
    canvas.style.height = `${expectedHeight}px`

    const renderPromise = renderPdfPage(
      documentProxy, pageNumber, canvas, scale, () => isDisposed,
      (task) => { renderTaskRef.current = task },
    )

    void renderPromise
      .then((renderTask) => {
        if (isDisposed) {
          renderTask?.cancel()
          return
        }
        renderTaskRef.current = renderTask
      })
      .catch((error: unknown) => {
        if (isDisposed || (error instanceof Error && error.name === 'RenderingCancelledException')) {
          return
        }
        setErrorMessage(toUserFacingErrorMessage(error, 'This PDF page could not be rendered.'))
      })

    return () => {
      isDisposed = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
      canvas.width = 0
      canvas.height = 0
    }
  }, [isNearViewport, documentProxy, pageLayout.height, pageLayout.width, pageNumber, scale])

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-16 min-w-16 items-center justify-center border border-border bg-white"
      style={{
        height: `${Math.max(1, Math.ceil(pageLayout.height * (scale / PDF_PAGE_SCALE)))}px`,
        width: `${Math.max(1, Math.ceil(pageLayout.width * (scale / PDF_PAGE_SCALE)))}px`,
      }}
    >
      <canvas ref={canvasRef} aria-label={`Page ${pageNumber}`} className={errorMessage ? 'hidden' : 'block'} />
      {errorMessage ? (
        <div className="max-w-sm px-6 py-8 text-center text-sm text-subtle-foreground">
          <div className="font-medium text-foreground">Page {pageNumber} unavailable</div>
          <p className="mt-2 leading-6">{errorMessage}</p>
        </div>
      ) : null}
    </div>
  )
})
