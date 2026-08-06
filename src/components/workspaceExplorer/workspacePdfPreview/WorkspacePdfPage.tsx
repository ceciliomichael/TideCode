import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { memo, useEffect, useRef, useState } from 'react'
import {
  PDF_PAGE_SCALE,
  PDF_RENDER_RESOLUTION_SCALE,
  type PdfPageLayout,
  type PdfPageRenderSnapshot,
} from '../../../lib/pdfPreviewRenderCache'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'

interface WorkspacePdfPageProps {
  documentProxy: PDFDocumentProxy
  cachedPageRender?: Promise<PdfPageRenderSnapshot>
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
) {
  const page: PDFPageProxy = await documentProxy.getPage(pageNumber)
  if (isDisposed()) {
    return null
  }

  const viewport = page.getViewport({ scale })
  const devicePixelRatio = Math.min(
    3,
    Math.max(window.devicePixelRatio || 1, PDF_RENDER_RESOLUTION_SCALE),
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
  await renderTask.promise
  return renderTask
}

export const WorkspacePdfPage = memo(function WorkspacePdfPage({
  cachedPageRender,
  documentProxy,
  pageNumber,
  pageLayout,
  scale,
}: WorkspacePdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isDisposed = false
    setErrorMessage(null)
    renderTaskRef.current?.cancel()
    renderTaskRef.current = null

    const canvas = canvasRef.current
    if (!canvas) {
      return () => {
        isDisposed = true
      }
    }

    const expectedWidth = Math.ceil(pageLayout.width * (scale / PDF_PAGE_SCALE))
    const expectedHeight = Math.ceil(pageLayout.height * (scale / PDF_PAGE_SCALE))
    canvas.style.width = `${expectedWidth}px`
    canvas.style.height = `${expectedHeight}px`

    const renderPromise = Math.abs(scale - PDF_PAGE_SCALE) < 0.001 && cachedPageRender
      ? cachedPageRender.then((snapshot) => {
          if (isDisposed) {
            return null
          }

          canvas.width = snapshot.pixelWidth
          canvas.height = snapshot.pixelHeight
          canvas.style.width = `${snapshot.width}px`
          canvas.style.height = `${snapshot.height}px`
          const canvasContext = canvas.getContext('2d')
          if (!canvasContext) {
            throw new Error('The browser could not create a PDF canvas.')
          }
          canvasContext.setTransform(1, 0, 0, 1, 0, 0)
          if (snapshot.bitmap) {
            canvasContext.drawImage(snapshot.bitmap, 0, 0, snapshot.pixelWidth, snapshot.pixelHeight)
          } else if (snapshot.dataUrl) {
            const dataUrl = snapshot.dataUrl
            const image = new Image()
            return new Promise<RenderTask | null>((resolve, reject) => {
              image.onload = () => {
                if (isDisposed) {
                  resolve(null)
                  return
                }
                canvasContext.drawImage(image, 0, 0, snapshot.pixelWidth, snapshot.pixelHeight)
                resolve(null)
              }
              image.onerror = () => reject(new Error('The cached PDF page image could not be decoded.'))
              image.src = dataUrl
            })
          }
          return null
        })
      : renderPdfPage(documentProxy, pageNumber, canvas, scale, () => isDisposed)

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
    }
  }, [cachedPageRender, documentProxy, pageLayout.height, pageLayout.width, pageNumber, scale])

  return (
    <div
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
