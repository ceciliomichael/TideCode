import type { NativeImage, WebContents } from 'electron'

const FRAME_INTERVAL_MS = 100
const PREVIEW_JPEG_QUALITY = 72
const MAX_PREVIEW_DIMENSION = 1600
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024

interface LivePreviewState {
  visible: boolean
  pending: NativeImage | null
  timer: ReturnType<typeof setTimeout> | null
  lastSent: number
  publish: (imageDataUrl: string) => void
}

const previews = new WeakMap<WebContents, LivePreviewState>()

/** Offscreen paint is a UI feed, never a model observation or page mutation. */
export function attachAgentLivePreview(contents: WebContents, publish: (imageDataUrl: string) => void) {
  const existing = previews.get(contents)
  if (existing) {
    existing.publish = publish
    return
  }

  const state: LivePreviewState = {
    visible: false,
    pending: null,
    timer: null,
    lastSent: 0,
    publish,
  }
  previews.set(contents, state)

  const flush = () => {
    state.timer = null
    const image = state.pending
    state.pending = null
    if (!state.visible || contents.isDestroyed() || !image || image.isEmpty()) return
    state.lastSent = Date.now()
    try {
      const size = image.getSize()
      const scale = Math.min(1, MAX_PREVIEW_DIMENSION / Math.max(size.width, size.height))
      const preview = scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
          })
        : image
      const jpeg = preview.toJPEG(PREVIEW_JPEG_QUALITY)
      if (jpeg.length <= MAX_PREVIEW_BYTES) {
        state.publish('data:image/jpeg;base64,' + jpeg.toString('base64'))
      }
    } catch {
      // A preview frame must not interrupt browser automation.
    }
  }

  const onPaint = (_event: unknown, _dirtyRect: unknown, image: NativeImage) => {
    if (!state.visible) return
    state.pending = image
    if (state.timer !== null) return
    const elapsed = Date.now() - state.lastSent
    state.timer = setTimeout(flush, Math.max(0, FRAME_INTERVAL_MS - elapsed))
  }
  contents.on('paint', onPaint)
  contents.once('destroyed', () => {
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = null
    state.pending = null
    state.visible = false
    contents.removeListener('paint', onPaint)
    previews.delete(contents)
  })
  contents.setFrameRate(5)
}

export function isAgentLivePreviewVisible(contents: WebContents) {
  return previews.get(contents)?.visible === true
}

export function setAgentLivePreviewVisible(contents: WebContents, visible: boolean) {
  const state = previews.get(contents)
  if (!state || contents.isDestroyed()) return
  state.visible = visible
  if (!visible) {
    state.pending = null
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = null
    contents.setFrameRate(5)
    return
  }
  contents.setFrameRate(12)
  contents.startPainting()
  contents.invalidate()
}
