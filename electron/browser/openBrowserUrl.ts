import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { BrowserUrlRequest } from '../../src/types/browser'

export function openBrowserUrl(owner: Pick<WebContents, 'isDestroyed' | 'send'>, rawUrl: string, incognito = false) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS links can open in the browser.')
  }
  if (owner.isDestroyed()) {
    throw new Error('The workspace window has closed.')
  }
  const request: BrowserUrlRequest = { id: randomUUID(), url: url.href, incognito }
  owner.send('browser:openUrl', request)
}
