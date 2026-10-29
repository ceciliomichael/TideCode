import type { WebContents } from 'electron'
import { clearAgentObservation } from './agentObservation'
import { requireBrowserUrl } from './agentTabs'

export type BrowserNavigationAction = 'goto' | 'back' | 'forward' | 'reload' | 'stop'
export type BrowserNavigationWait = 'none' | 'commit' | 'domcontentloaded' | 'load'

export interface BrowserNavigationInput {
  action: BrowserNavigationAction
  url?: string
  wait_until?: BrowserNavigationWait
  timeout_ms?: number
}

export function validateBrowserNavigation(input: BrowserNavigationInput): void {
  if (!input || !['goto', 'back', 'forward', 'reload', 'stop'].includes(input.action)) {
    throw new Error('Unknown browser navigation action.')
  }
  if (input.action === 'goto') {
    if (typeof input.url !== 'string') throw new Error('A URL is required for goto.')
    requireBrowserUrl(input.url)
  } else if (input.url !== undefined) {
    throw new Error('Only goto accepts a URL.')
  }
  if (input.wait_until !== undefined && !['none', 'commit', 'domcontentloaded', 'load'].includes(input.wait_until)) {
    throw new Error('Unknown browser navigation wait mode.')
  }
  if (input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 100 || input.timeout_ms > 20000)) {
    throw new Error('Navigation timeout must be between 100 and 20000 milliseconds.')
  }
}

export async function navigateAgentPage(contents: WebContents, input: BrowserNavigationInput, signal?: AbortSignal) {
  validateBrowserNavigation(input)
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  if (contents.isDestroyed()) throw new Error('The browser tab is closed.')
  const from = contents.getURL()
  const waitUntil = input.action === 'stop' ? 'none' : input.wait_until ?? 'domcontentloaded'
  if (input.action === 'back' && !contents.navigationHistory.canGoBack()) throw new Error('This tab cannot navigate backward.')
  if (input.action === 'forward' && !contents.navigationHistory.canGoForward()) throw new Error('This tab cannot navigate forward.')
  if (input.action === 'stop') {
    contents.stop()
    return { action: input.action, from, url: contents.getURL(), loading: contents.isLoading(), status: 'stopped' }
  }
  clearAgentObservation(contents)
  const timeoutMs = input.timeout_ms ?? 12000
  const milestone = waitUntil === 'commit' ? 'did-navigate'
    : waitUntil === 'domcontentloaded' ? 'dom-ready' : 'did-finish-load'
  const target = input.action === 'goto' ? requireBrowserUrl(input.url!) : undefined
  let started = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let cleanup = () => {}
  let rejectNavigation: (error: Error) => void = () => {}
  const complete = waitUntil === 'none' ? Promise.resolve('dispatched') : new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve('reached ' + waitUntil)
    }
    rejectNavigation = (error) => finish(error)
    const onAbort = () => {
      contents.stop()
      finish(new Error('Browser operation cancelled.'))
    }
    const onFailure = (_event: unknown, errorCode: number, description: string, validatedURL: string, isMainFrame: boolean) => {
      if (isMainFrame && errorCode !== -3) finish(new Error('Navigation failed: ' + description + ' (' + validatedURL + ').'))
    }
    const onMilestone = () => {
      if (started) finish()
    }
    cleanup = () => {
      if (milestone === 'did-navigate') contents.removeListener('did-navigate', onMilestone)
      else if (milestone === 'dom-ready') contents.removeListener('dom-ready', onMilestone)
      else contents.removeListener('did-finish-load', onMilestone)
      contents.removeListener('did-fail-load', onFailure)
      signal?.removeEventListener('abort', onAbort)
      if (timer) clearTimeout(timer)
    }
    if (milestone === 'did-navigate') contents.on('did-navigate', onMilestone)
    else if (milestone === 'dom-ready') contents.on('dom-ready', onMilestone)
    else contents.on('did-finish-load', onMilestone)
    contents.on('did-fail-load', onFailure)
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(new Error(
      'Navigation did not reach ' + waitUntil + ' within ' + timeoutMs + ' milliseconds. '
      + 'Current URL: ' + contents.getURL() + '. Page loading: ' + (contents.isLoading() ? 'yes' : 'no')
      + '. The page may have navigated despite this timeout. Inspect browser.read before retrying.',
    )), timeoutMs)
  })
  started = true
  try {
    if (input.action === 'goto') {
      const loading = contents.loadURL(target!)
      void loading.catch((error: unknown) => {
        if (waitUntil !== 'none') {
          rejectNavigation(error instanceof Error ? error : new Error('Browser navigation failed.'))
        }
      })
    } else if (input.action === 'back') contents.navigationHistory.goBack()
    else if (input.action === 'forward') contents.navigationHistory.goForward()
    else contents.reload()
    const status = await complete
    if (signal?.aborted) throw new Error('Browser operation cancelled.')
    return { action: input.action, from, url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(), status }
  } finally {
    cleanup()
  }
}
