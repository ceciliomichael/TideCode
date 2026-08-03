import { renderAsync } from 'docx-preview'
import { paginateDocxPages } from './docxPageLayout'
import { sanitizeDocxRenderedDom } from './docxRenderedSecurity'

export interface DocxPreviewRenderSnapshot {
  documentHtml: string
  height: number
  pageCount: number
  stylesHtml: string
  width: number
}

const MAX_CACHED_DOCX_RENDERS = 3
const DOCX_RENDER_HOST_CLASS_NAME = 'workspace-docx-preview'
const DOCX_RENDER_OPTIONS = {
  breakPages: true,
  className: 'tidecode-docx',
  ignoreLastRenderedPageBreak: false,
  renderAltChunks: false,
  useBase64URL: true,
} as const

interface RenderQueueEntry {
  dataUrl: string
  isSettled: boolean
  promise: Promise<DocxPreviewRenderSnapshot>
  reject: (reason?: unknown) => void
  resolve: (snapshot: DocxPreviewRenderSnapshot) => void
  state: 'queued' | 'running'
}

const renderCache = new Map<string, RenderQueueEntry>()
const renderQueue: RenderQueueEntry[] = []
let isRenderQueueRunning = false

function decodeDocxDataUrl(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex < 0) {
    throw new Error('The DOCX preview data was invalid.')
  }

  const base64Content = dataUrl.slice(separatorIndex + 1)
  const binaryContent = window.atob(base64Content)
  const bytes = new Uint8Array(binaryContent.length)
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index)
  }
  return bytes.buffer as ArrayBuffer
}

function createRenderHost() {
  const host = document.createElement('div')
  host.className = DOCX_RENDER_HOST_CLASS_NAME
  host.style.position = 'absolute'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '1200px'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.contain = 'layout style paint'

  const styles = document.createElement('div')
  styles.className = 'docx-rendered-styles'
  styles.setAttribute('aria-hidden', 'true')

  const documentContainer = document.createElement('div')
  documentContainer.className = 'docx-rendered-document'
  host.append(styles, documentContainer)
  document.body.append(host)

  return { documentContainer, host, styles }
}

function measureDocxPreview(container: HTMLElement) {
  const wrapper = container.firstElementChild as HTMLElement | null
  const pages = wrapper ? Array.from(wrapper.querySelectorAll<HTMLElement>('section.tidecode-docx')) : []
  const width = Math.max(0, ...pages.map((page) => page.offsetLeft + page.offsetWidth))
  const height = wrapper?.scrollHeight ?? container.scrollHeight
  return {
    height: Math.ceil(Math.max(1, height)),
    width: Math.ceil(Math.max(1, width)),
  }
}

async function renderDocxPreview(dataUrl: string): Promise<DocxPreviewRenderSnapshot> {
  const { documentContainer, host, styles } = createRenderHost()
  try {
    await renderAsync(decodeDocxDataUrl(dataUrl), documentContainer, styles, DOCX_RENDER_OPTIONS)
    sanitizeDocxRenderedDom(documentContainer)
    const pageCount = paginateDocxPages(documentContainer)
    const renderedSize = measureDocxPreview(documentContainer)
    return {
      documentHtml: documentContainer.innerHTML,
      height: renderedSize.height,
      pageCount,
      stylesHtml: styles.innerHTML,
      width: renderedSize.width,
    }
  } finally {
    host.remove()
  }
}

function pruneRenderCache() {
  while (renderCache.size > MAX_CACHED_DOCX_RENDERS) {
    const oldestSettledKey = Array.from(renderCache.entries()).find(([, entry]) => entry.isSettled)?.[0]
    if (!oldestSettledKey) {
      return
    }
    renderCache.delete(oldestSettledKey)
  }
}

function runNextRender() {
  if (isRenderQueueRunning) {
    return
  }

  const nextEntry = renderQueue.shift()
  if (!nextEntry) {
    return
  }

  isRenderQueueRunning = true
  nextEntry.state = 'running'
  void renderDocxPreview(nextEntry.dataUrl)
    .then((snapshot) => {
      nextEntry.isSettled = true
      nextEntry.resolve(snapshot)
    })
    .catch((error: unknown) => {
      nextEntry.isSettled = true
      renderCache.delete(nextEntry.dataUrl)
      nextEntry.reject(error)
    })
    .finally(() => {
      isRenderQueueRunning = false
      pruneRenderCache()
      runNextRender()
    })
}

function promoteRender(dataUrl: string) {
  const entry = renderCache.get(dataUrl)
  if (!entry || entry.state !== 'queued') {
    return
  }

  const queueIndex = renderQueue.indexOf(entry)
  if (queueIndex >= 0) {
    renderQueue.splice(queueIndex, 1)
    renderQueue.unshift(entry)
  }
}

function createRenderEntry(dataUrl: string, isPriority: boolean) {
  let resolveRender!: (snapshot: DocxPreviewRenderSnapshot) => void
  let rejectRender!: (reason?: unknown) => void
  const promise = new Promise<DocxPreviewRenderSnapshot>((resolve, reject) => {
    resolveRender = resolve
    rejectRender = reject
  })
  const entry: RenderQueueEntry = {
    dataUrl,
    isSettled: false,
    promise,
    reject: rejectRender,
    resolve: resolveRender,
    state: 'queued',
  }
  renderCache.set(dataUrl, entry)
  if (isPriority) {
    renderQueue.unshift(entry)
  } else {
    renderQueue.push(entry)
  }
  pruneRenderCache()
  runNextRender()
  return promise
}

function getOrCreateRender(dataUrl: string, isPriority: boolean) {
  const cachedRender = renderCache.get(dataUrl)
  if (cachedRender) {
    if (isPriority) {
      promoteRender(dataUrl)
    }
    return cachedRender.promise
  }

  return createRenderEntry(dataUrl, isPriority)
}

export function ensureDocxPreviewRender(dataUrl: string) {
  return getOrCreateRender(dataUrl, false)
}

export function requestDocxPreviewRender(dataUrl: string) {
  return getOrCreateRender(dataUrl, true)
}

export function prefetchDocxPreviewRender(dataUrl: string) {
  void getOrCreateRender(dataUrl, false).catch(() => undefined)
}

export function clearDocxPreviewRenderCache() {
  renderQueue.splice(0).forEach((entry) => {
    entry.reject(new Error('The DOCX preview cache was cleared.'))
  })
  renderCache.clear()
}
