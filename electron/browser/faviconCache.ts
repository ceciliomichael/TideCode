import { net, type WebContents } from 'electron'
import type { BrowserPageFavicon } from '../../src/types/browser'

const MAX_ICON_BYTES = 128 * 1024
const MAX_CACHED_ICONS = 128
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'])

function iconMimeType(bytes: Buffer, contentType: string): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return 'image/jpeg'
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) {
    return 'image/x-icon'
  }
  if (bytes.subarray(0, 3).toString() === 'GIF') {
    return 'image/gif'
  }
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    return 'image/webp'
  }
  if (contentType === 'image/svg+xml') {
    return contentType
  }
  return null
}

export class BrowserFaviconCache {
  private readonly downloads = new Map<string, Promise<string>>()
  private readonly pages = new Map<number, { url: string; image: Promise<string>; dataUrl: string }>()

  constructor(private readonly fetchIcon: typeof net.fetch = net.fetch) {}

  private async download(source: string): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      if (source.length > 4096) {
        return ''
      }
      let url = new URL(source)
      let response: Awaited<ReturnType<typeof net.fetch>> | undefined
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
          return ''
        }
        response = await this.fetchIcon(url.href, {
          signal: controller.signal,
          credentials: 'omit',
          redirect: 'manual',
          bypassCustomProtocolHandlers: true,
        })
        if (response.status < 300 || response.status >= 400) {
          break
        }
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === 3) {
          return ''
        }
        url = new URL(location, url)
      }
      if (!response) {
        return ''
      }
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_ICON_BYTES) {
        await response.body?.cancel()
        return ''
      }
      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) {
            break
          }
          size += chunk.value.byteLength
          if (size > MAX_ICON_BYTES) {
            await reader.cancel()
            return ''
          }
          chunks.push(Buffer.from(chunk.value))
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = Buffer.concat(chunks)
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      const mimeType = iconMimeType(bytes, contentType)
      if (!mimeType) {
        return ''
      }
      return `data:${mimeType};base64,${bytes.toString('base64')}`
    } catch {
      return ''
    } finally {
      clearTimeout(timeout)
    }
  }

  load(source: string): Promise<string> {
    // Inline page icons already contain the bytes; never fetch a data URL.
    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u)
      if (match && IMAGE_TYPES.has(match[1]) && match[2].length <= Math.ceil(MAX_ICON_BYTES / 3) * 4) {
        return Promise.resolve(source)
      }
      return Promise.resolve('')
    }
    const cached = this.downloads.get(source)
    if (cached) {
      return cached
    }
    if (this.downloads.size >= MAX_CACHED_ICONS) {
      const oldest = this.downloads.keys().next().value
      if (oldest !== undefined) {
        this.downloads.delete(oldest)
      }
    }
    const download = this.download(source)
    this.downloads.set(source, download)
    return download
  }

  track(contents: WebContents) {
    contents.on('did-navigate', () => this.pages.delete(contents.id))
    contents.once('destroyed', () => this.pages.delete(contents.id))
    contents.on('page-favicon-updated', (_event, favicons) => {
      const source = favicons.find((candidate) => typeof candidate === 'string' && candidate.trim())
      if (!source) {
        this.pages.delete(contents.id)
        return
      }
      const page = { url: contents.getURL(), image: this.load(source), dataUrl: '' }
      this.pages.set(contents.id, page)
      void page.image.then((dataUrl) => {
        if (this.pages.get(contents.id) === page && !contents.isDestroyed() && contents.getURL() === page.url) {
          page.dataUrl = dataUrl
        }
      })
    })
  }

  peek(contents: WebContents): string {
    const page = this.pages.get(contents.id)
    if (!page || contents.isDestroyed() || contents.getURL() !== page.url) {
      return ''
    }
    return page.dataUrl
  }

  async get(contents: WebContents): Promise<BrowserPageFavicon | null> {
    const page = this.pages.get(contents.id)
    if (!page) {
      return null
    }
    const faviconDataUrl = await page.image
    if (!faviconDataUrl || this.pages.get(contents.id) !== page || contents.isDestroyed() || contents.getURL() !== page.url) {
      return null
    }
    return { url: page.url, faviconDataUrl }
  }
}

export const browserFaviconCache = new BrowserFaviconCache()
