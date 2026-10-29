import { nativeImage } from 'electron'
import type { AgentCursorPosition } from './agentCursor'
import type { AgentViewport } from './agentViewport'

type Point = { x: number; y: number }
type Color = readonly [red: number, green: number, blue: number]

const WHITE: Color = [255, 255, 255]
const DARK: Color = [23, 23, 23]
const GREEN: Color = [22, 163, 74]

/**
 * Draw on the bitmap produced by Electron's own image codec. No native npm
 * image module is needed in the packaged main process.
 */
function drawCursor(bitmap: Buffer, width: number, height: number, cursor: AgentCursorPosition) {
  // Electron's bitmap representation is BGRA on Windows and Linux, RGBA on macOS.
  const rgba = process.platform === 'darwin'
  const paint = (x: number, y: number, color: Color) => {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return
    const offset = (py * width + px) * 4
    bitmap[offset] = rgba ? color[0] : color[2]
    bitmap[offset + 1] = color[1]
    bitmap[offset + 2] = rgba ? color[2] : color[0]
    bitmap[offset + 3] = 255
  }
  const disc = (cx: number, cy: number, radius: number, color: Color) => {
    for (let y = Math.ceil(cy - radius); y <= Math.floor(cy + radius); y++) {
      for (let x = Math.ceil(cx - radius); x <= Math.floor(cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) paint(x, y, color)
      }
    }
  }
  const line = (a: Point, b: Point, radius: number, color: Color) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(length * 2))
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      disc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, color)
    }
  }
  const base = { x: cursor.x, y: cursor.y }
  if (cursor.kind === 'crosshair') {
    const segments: [Point, Point][] = [
      [{ x: base.x - 13, y: base.y }, { x: base.x + 13, y: base.y }],
      [{ x: base.x, y: base.y - 13 }, { x: base.x, y: base.y + 13 }],
    ]
    for (const [a, b] of segments) line(a, b, 2.5, WHITE)
    for (const [a, b] of segments) line(a, b, 1, DARK)
  } else {
    const outline = [
      [0, 0], [0, 26], [6, 19], [13, 33],
      [19, 30], [12, 17], [24, 16],
    ].map(([x, y]) => ({ x: base.x + x, y: base.y + y }))
    // Even-odd fill keeps the cursor shape visible on light and dark pages.
    for (let y = Math.max(0, Math.floor(base.y)); y <= Math.min(height - 1, Math.ceil(base.y + 33)); y++) {
      for (let x = Math.max(0, Math.floor(base.x)); x <= Math.min(width - 1, Math.ceil(base.x + 24)); x++) {
        let inside = false
        for (let j = 0, k = outline.length - 1; j < outline.length; k = j++) {
          const a = outline[j]
          const b = outline[k]
          if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside
          }
        }
        if (inside) paint(x, y, DARK)
      }
    }
    for (let i = 0; i < outline.length; i++) {
      line(outline[i], outline[(i + 1) % outline.length], 1.2, WHITE)
    }
  }
  disc(base.x + 24, base.y + 28, 6, WHITE)
  disc(base.x + 24, base.y + 28, 4.5, GREEN)
}

/** Overlay the last-known AI pointer without changing the webpage or viewport. */
export async function addAgentCursorToScreenshot(
  screenshot: Buffer,
  viewport: Readonly<AgentViewport>,
  cursor: AgentCursorPosition | null,
): Promise<Buffer> {
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)
    || cursor.x < 0 || cursor.y < 0 || cursor.x >= viewport.width || cursor.y >= viewport.height) {
    return screenshot
  }
  const image = nativeImage.createFromBuffer(screenshot)
  const size = image.getSize()
  if (size.width !== viewport.width || size.height !== viewport.height) {
    throw new Error('Browser screenshot dimensions no longer match the active viewport.')
  }
  const pixels = image.toBitmap()
  drawCursor(pixels, size.width, size.height, cursor)
  return nativeImage.createFromBitmap(pixels, { width: size.width, height: size.height }).toPNG()
}
