import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPreviewResourceCache } from './pdfPreviewResourceCache'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export const PDF_PAGE_SCALE = 4 / 3
export const PDF_RENDER_RESOLUTION_SCALE = 2
export const PDF_MAX_CANVAS_PIXELS = 4 * 1024 * 1024

export interface PdfPageLayout {
  height: number
  width: number
}

export interface PdfPreviewRenderSnapshot {
  documentProxy: PDFDocumentProxy
  pageLayouts: readonly PdfPageLayout[]
}

function decodePdfDataUrl(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex < 0) {
    throw new Error('The PDF preview data was invalid.')
  }
  const binaryContent = window.atob(dataUrl.slice(separatorIndex + 1))
  const bytes = new Uint8Array(binaryContent.length)
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index)
  }
  return bytes
}

const previewCache = new PdfPreviewResourceCache<PdfPreviewRenderSnapshot>((dataUrl) => {
  const loadingTask = pdfjsLib.getDocument({ data: decodePdfDataUrl(dataUrl) })
  const promise = loadingTask.promise.then(async (documentProxy) => {
    const pageLayouts: PdfPageLayout[] = []
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber)
      const viewport = page.getViewport({ scale: PDF_PAGE_SCALE })
      pageLayouts.push({ height: Math.ceil(viewport.height), width: Math.ceil(viewport.width) })
      page.cleanup()
    }
    return { documentProxy, pageLayouts }
  })
  return {
    promise,
    dispose: () => {
      // This releases the worker even if the view closes during loading.
      void loadingTask.destroy().catch(() => undefined)
    },
  }
})

export function acquirePdfPreview(dataUrl: string) {
  return previewCache.acquire(dataUrl)
}

export async function requestPdfPreviewRender(dataUrl: string) {
  const lease = acquirePdfPreview(dataUrl)
  try {
    await lease.promise
  } finally {
    lease.release()
  }
}

export function prefetchPdfPreviewRender(dataUrl: string) {
  void requestPdfPreviewRender(dataUrl).catch(() => undefined)
}

export function clearPdfPreviewRenderCache() {
  previewCache.clear()
}
