import type { BrowserWindow, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BROWSER_SESSION_PARTITION } from '../../src/types/browser'
import { clearBrowserStructure } from './agentPageStructure'
import { requireBrowserElectronRuntime } from './agentElectronRuntime'
import { AgentBrowserOperation } from './agentBrowserOperation'
import { clearAgentObservation } from './agentObservation'
import { observeAgentCursor } from './agentCursor'
import { getAgentViewport } from './agentViewport'
import { rememberAgentViewport, resolveAgentViewport, type AgentViewport } from './agentViewport'

const MAX_AGENT_TABS_PER_PROJECT = 12

export interface AgentBrowserTab {
  id: string
  projectPath: string
  kind: 'visible' | 'agent'
  createdByAgent: boolean
  contents: WebContents
  ownerId: number
  window?: BrowserWindow
}

const tabs = new Map<string, AgentBrowserTab>()
const operations = new Map<string, Promise<unknown>>()
const agentFavicons = new WeakMap<WebContents, string>()

export function getAgentTabFavicon(contents: WebContents) {
  return agentFavicons.get(contents) ?? ''
}

export function requireBrowserUrl(raw: string) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('A browser URL is required.')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Supply an absolute http:// or https:// URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Browser automation only accepts HTTP(S) URLs without embedded credentials.')
  }
  return url.href
}

export function registerVisibleBrowserTab(input: {
  id: string
  projectPath: string
  contents: WebContents
  ownerId: number
}) {
  if (!input.id || input.contents.isDestroyed()) throw new Error('The browser tab is not available.')
  const existing = tabs.get(input.id)
  if (existing && existing.contents !== input.contents) throw new Error('Browser tab ID is already in use.')
  if (existing) return existing
  const project = path.resolve(input.projectPath)
  const tab: AgentBrowserTab = {
    ...input,
    projectPath: project,
    kind: 'visible',
    createdByAgent: false,
  }
  tabs.set(input.id, tab)
  input.contents.once('destroyed', () => {
    if (tabs.get(input.id)?.contents === input.contents) tabs.delete(input.id)
  })
  input.contents.on('did-navigate', () => {
    clearBrowserStructure(input.contents)
    clearAgentObservation(input.contents)
  })
  return tab
}

export function listAgentBrowserTabs(projectPath: string, page: number) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Page must be a positive integer.')
  const project = path.resolve(projectPath)
  const matches = [...tabs.values()].filter((tab) => {
    if (tab.contents.isDestroyed()) {
      tabs.delete(tab.id)
      return false
    }

    if (tab.projectPath !== project) return false
    try {
      requireBrowserUrl(tab.contents.getURL())
      return true
    } catch {
      return false
    }
  })
  const start = (page - 1) * 10
  return {
    page,
    page_size: 10,
    total: matches.length,
    has_more: start + 10 < matches.length,
    tabs: matches.slice(start, start + 10).map((tab) => ({
      tab_id: tab.id,
      kind: tab.kind,
      title: tab.contents.getTitle() || 'Untitled',
      url: tab.contents.getURL(),
      loading: tab.contents.isLoading(),
    })),
  }
}

export function listOpenAgentTabs(projectPath: string) {
  const project = path.resolve(projectPath)
  return [...tabs.values()]
    .filter((tab) => tab.kind === 'agent' && tab.projectPath === project && !tab.contents.isDestroyed())
    .map((tab) => ({
      tabId: tab.id,
      projectPath: tab.projectPath,
      url: tab.contents.getURL(),
      title: tab.contents.getTitle() || 'Untitled',
    }))
}

export function resolveAgentBrowserTab(projectPath: string, id: string, allowUnsupportedUrl = false) {
  if (typeof id !== 'string' || !id) throw new Error('tab_id is required.')
  const tab = tabs.get(id)
  if (!tab || tab.projectPath !== path.resolve(projectPath) || tab.contents.isDestroyed()) {
    throw new Error('Browser tab is no longer available in this project.')
  }
  if (!allowUnsupportedUrl) requireBrowserUrl(tab.contents.getURL())
  return tab
}

export async function withAgentBrowserTab<T>(
  projectPath: string,
  id: string,
  operation: (tab: AgentBrowserTab) => Promise<T>,
  allowUnsupportedUrl = false,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  const previous = operations.get(id) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => next)
  operations.set(id, queued)
  try {
    await new AgentBrowserOperation(10_000, signal).run(
      'waiting for the previous operation on tab ' + id,
      () => previous.catch(() => undefined),
      () => undefined,
      10_000,
    )
    if (signal?.aborted) throw new Error('Browser operation cancelled.')
    return await operation(resolveAgentBrowserTab(projectPath, id, allowUnsupportedUrl))
  } finally {
    release()
    if (operations.get(id) === queued) operations.delete(id)
  }
}

export async function openAgentBrowserTab(
  projectPath: string, url: string, owner: WebContents, newTab = false, signal?: AbortSignal,
  requestedViewport?: AgentViewport,
) {
  const viewport = resolveAgentViewport(requestedViewport)
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  const { app, BrowserWindow } = requireBrowserElectronRuntime()
  if (!app.isReady()) throw new Error('Browser automation requires the TideCode desktop application.')
  const target = requireBrowserUrl(url)
  const project = path.resolve(projectPath)
  if (!newTab) {
    const existing = [...tabs.values()].find((tab) =>
      tab.projectPath === project && tab.createdByAgent && !tab.contents.isDestroyed()
      && tab.ownerId === owner.id && tab.contents.getURL() === target
      && getAgentViewport(tab.contents).width === viewport.width
      && getAgentViewport(tab.contents).height === viewport.height)
    if (existing) {
      return {
        tab_id: existing.id, url: target,
        title: existing.contents.getTitle(), status: 'reused', width: viewport.width, height: viewport.height,
      }
    }
  }
  const agentCount = [...tabs.values()].filter((tab) =>
    tab.projectPath === project && tab.kind === 'agent' && !tab.contents.isDestroyed()).length
  if (agentCount >= MAX_AGENT_TABS_PER_PROJECT) {
    throw new Error('Too many AI browser tabs. Close an existing tab before opening another.')
  }
  const id = randomUUID()
  const window = new BrowserWindow({
    show: false,
    width: viewport.width,
    height: viewport.height,
    webPreferences: {
      offscreen: { useSharedTexture: false },
      partition: BROWSER_SESSION_PARTITION,
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const contents = window.webContents
  rememberAgentViewport(contents, viewport)
  contents.on('page-favicon-updated', (_event, favicons) => {
    agentFavicons.set(contents, favicons[0] ?? '')
  })
  // Agent pages must not spawn visible popups or navigate into privileged URLs.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, navigationURL) => {
    try {
      requireBrowserUrl(navigationURL)
    } catch {
      event.preventDefault()
    }
  })
  const tab: AgentBrowserTab = {
    id, projectPath: project, kind: 'agent', createdByAgent: true,
    contents, ownerId: owner.id, window,
  }
  tabs.set(id, tab)
  observeAgentCursor(contents, (cursor) => {
    if (owner.isDestroyed()) return
    const viewport = getAgentViewport(contents)
    owner.send('browser:agentCursor', {
      tabId: id, projectPath: project,
      width: viewport.width, height: viewport.height, cursor,
    })
  })
  const onOwnerDestroyed = () => {
    if (tabs.get(id) === tab) {
      tabs.delete(id)
      if (!window.isDestroyed()) window.destroy()
    }
  }
  owner.once('destroyed', onOwnerDestroyed)
  contents.once('destroyed', () => {
    if (tabs.get(id) === tab) tabs.delete(id)
    owner.removeListener('destroyed', onOwnerDestroyed)
  })
  contents.on('did-navigate', () => {
    clearBrowserStructure(contents)
    clearAgentObservation(contents)
  })
  try {
    // Resolve on DOM readiness rather than waiting for images and trackers to
    // finish, so an unrelated slow resource does not stall browser.open.
    const ready = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        contents.removeListener('dom-ready', onReady)
        contents.removeListener('did-fail-load', onFailed)
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = () => {
        cleanup()
        reject(new Error('Browser operation cancelled.'))
      }
      const onReady = () => {
        cleanup()
        resolve()
      }
      const onFailed = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
        if (!isMainFrame || code === -3) return
        cleanup()
        reject(new Error('The AI browser could not load the page: ' + description))
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('The AI browser page did not become ready within 15 seconds.'))
      }, 15_000)
      contents.once('dom-ready', onReady)
      contents.on('did-fail-load', onFailed)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    void contents.loadURL(target).catch(() => undefined)
    await ready
    if (signal?.aborted) throw new Error('Browser operation cancelled.')
    return { tab_id: id, url: contents.getURL() || target, title: contents.getTitle(), status: 'loaded', width: viewport.width, height: viewport.height }
  } catch (error) {
    tabs.delete(id)
    owner.removeListener('destroyed', onOwnerDestroyed)
    window.destroy()
    throw error
  }
}

export async function terminateAgentBrowserTab(projectPath: string, id: string) {
  return withAgentBrowserTab(projectPath, id, async (tab) => {
    if (tab.kind !== 'agent' || !tab.window) {
      throw new Error('User-owned browser tabs cannot be closed by AI.')
    }
    tabs.delete(id)
    tab.window.destroy()
    const { webContents } = requireBrowserElectronRuntime()
    const owner = webContents.fromId(tab.ownerId)
    if (owner && !owner.isDestroyed()) {
      owner.send('browser:terminateAgentTab', { tabId: id, projectPath: tab.projectPath })
    }
    return { tab_id: id, status: 'closed' }
  }, true)
}

export function unregisterVisibleBrowserTab(id: string, senderId: number) {
  const tab = tabs.get(id)
  if (tab?.kind === 'visible' && tab.ownerId === senderId) tabs.delete(id)
}

export async function isNormalAgentBrowserSession(contents: WebContents) {
  const { session } = requireBrowserElectronRuntime()
  return contents.session === session.fromPartition(BROWSER_SESSION_PARTITION)
}
