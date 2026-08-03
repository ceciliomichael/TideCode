import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export const PDF_PAGE_SCALE = 4 / 3
export const PDF_RENDER_RESOLUTION_SCALE = 2
export const PDF_PREFETCH_PAGE_LIMIT = 12

const MAX_CACHED_PDF_DOCUMENTS = 3

export interface PdfPageLayout {
  height: number
  width: number
}

export interface PdfPageRenderSnapshot extends PdfPageLayout {
  bitmap?: ImageBitmap
  dataUrl?: string
  pixelHeight: number
  pixelWidth: number
}

export interface PdfPreviewRenderSnapshot {
  documentProxy: PDFDocumentProxy
  pageLayouts: readonly PdfPageLayout[]
}

interface PdfPreviewCacheEntry {
  pageRenders: Map<number, Promise<PdfPageRenderSnapshot>>
  snapshotPromise: Promise<PdfPreviewRenderSnapshot>
}

const previewCache = new Map<string, PdfPreviewCacheEntry>()

function decodePdfDataUrl(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex < 0) {
    throw new Error('The PDF preview data was invalid.')
  }

  const base64Content = dataUrl.slice(separatorIndex + 1)
  const binaryContent = window.atob(base64Content)
  const bytes = new Uint8Array(binaryContent.length)
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index)
  }
  return bytes
}

function getRenderResolutionScale() {
  return Math.min(
    3,
    Math.max(window.devicePixelRatio || 1, PDF_RENDER_RESOLUTION_SCALE),
  )
}

async function loadPdfPreview(dataUrl: string): Promise<PdfPreviewRenderSnapshot> {
  const documentProxy = await pdfjsLib.getDocument({ data: decodePdfDataUrl(dataUrl) }).promise
  const pageLayouts = await Promise.all(
    Array.from({ length: documentProxy.numPages }, async (_, index) => {
      const page = await documentProxy.getPage(index + 1)
      const viewport = page.getViewport({ scale: PDF_PAGE_SCALE })
      return {
        height: Math.ceil(viewport.height),
        width: Math.ceil(viewport.width),
      }
    }),
  )

  return { documentProxy, pageLayouts }
}

async function renderPdfPageSnapshot(
  documentProxy: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfPageRenderSnapshot> {
  const page = await documentProxy.getPage(pageNumber)
  const viewport = page.getViewport({ scale: PDF_PAGE_SCALE })
  const resolutionScale = getRenderResolutionScale()
  const pixelWidth = Math.ceil(viewport.width * resolutionScale)
  const pixelHeight = Math.ceil(viewport.height * resolutionScale)
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  canvas.style.width = `${Math.ceil(viewport.width)}px`
  canvas.style.height = `${Math.ceil(viewport.height)}px`

  const canvasContext = canvas.getContext('2d')
  if (!canvasContext) {
    throw new Error('The browser could not create a PDF canvas.')
  }

  canvasContext.setTransform(1, 0, 0, 1, 0, 0)
  const renderTask: RenderTask = page.render({
    canvas,
    canvasContext,
    transform: [resolutionScale, 0, 0, resolutionScale, 0, 0],
    viewport,
  })
  await renderTask.promise

  let bitmap: ImageBitmap | undefined
  if (typeof window.createImageBitmap === 'function') {
    bitmap = await window.createImageBitmap(canvas)
  }

  return {
    bitmap,
    dataUrl: bitmap ? undefined : canvas.toDataURL('image/png'),
    height: Math.ceil(viewport.height),
    pixelHeight,
    pixelWidth,
    width: Math.ceil(viewport.width),
  }
}

function getOrCreateCacheEntry(dataUrl: string) {
  const cachedEntry = previewCache.get(dataUrl)
  if (cachedEntry) {
    return cachedEntry
  }

  const entry: PdfPreviewCacheEntry = {
    pageRenders: new Map(),
    snapshotPromise: Promise.resolve(null as never),
  }
  entry.snapshotPromise = loadPdfPreview(dataUrl).catch((error: unknown) => {
    previewCache.delete(dataUrl)
    throw error
  })
  previewCache.set(dataUrl, entry)

  while (previewCache.size > MAX_CACHED_PDF_DOCUMENTS) {
    const oldestKey = previewCache.keys().next().value
    if (typeof oldestKey !== 'string' || oldestKey === dataUrl) {
      break
    }
    previewCache.delete(oldestKey)
  }

  return entry
}

export function requestPdfPreviewRender(dataUrl: string) {
  return getOrCreateCacheEntry(dataUrl).snapshotPromise
}

export function ensurePdfPageRender(dataUrl: string, pageNumber: number) {
  const entry = getOrCreateCacheEntry(dataUrl)
  const cachedPageRender = entry.pageRenders.get(pageNumber)
  if (cachedPageRender) {
    return cachedPageRender
  }

  const pageRender = entry.snapshotPromise.then((snapshot) =>
    renderPdfPageSnapshot(snapshot.documentProxy, pageNumber),
  ).catch((error: unknown) => {
    entry.pageRenders.delete(pageNumber)
    throw error
  })
  entry.pageRenders.set(pageNumber, pageRender)
  return pageRender
}

export function prefetchPdfPreviewRender(dataUrl: string) {
  void requestPdfPreviewRender(dataUrl)
    .then((snapshot) => {
      const pageCount = Math.min(snapshot.pageLayouts.length, PDF_PREFETCH_PAGE_LIMIT)
      return Promise.all(
        Array.from({ length: pageCount }, (_, index) => ensurePdfPageRender(dataUrl, index + 1)),
      )
    })
    .catch(() => undefined)
}

export function clearPdfPreviewRenderCache() {
  previewCache.clear()
}
