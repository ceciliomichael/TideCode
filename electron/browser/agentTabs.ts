import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BROWSER_SESSION_PARTITION } from '../../src/types/browser'
import { clearBrowserStructure } from './agentPageStructure'
import { requireBrowserElectronRuntime } from './agentElectronRuntime'
import { AgentBrowserOperation } from './agentBrowserOperation'

const MAX_AGENT_TABS_PER_PROJECT = 12

export interface AgentBrowserTab {
  id: string
  projectPath: string
  kind: 'visible'
  createdByAgent: boolean
  contents: WebContents
  ownerId: number
}

const tabs = new Map<string, AgentBrowserTab>()
const operations = new Map<string, Promise<unknown>>()
const pendingOpen = new Map<string, {
  projectPath: string
  resolve: (tab: AgentBrowserTab) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}>()

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
  const pending = pendingOpen.get(input.id)
  const project = path.resolve(input.projectPath)
  if (pending && pending.projectPath !== project) {
    throw new Error('The registered browser tab belongs to another project.')
  }
  const tab: AgentBrowserTab = {
    ...input,
    projectPath: project,
    kind: 'visible',
    createdByAgent: Boolean(pending),
  }
  tabs.set(input.id, tab)
  if (pending) {
    pendingOpen.delete(input.id)
    clearTimeout(pending.timeout)
    pending.resolve(tab)
  }
  input.contents.once('destroyed', () => {
    if (tabs.get(input.id)?.contents === input.contents) tabs.delete(input.id)
  })
  input.contents.on('did-navigate', () => clearBrowserStructure(input.contents))
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
): Promise<T> {
  const previous = operations.get(id) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.catch(() => undefined).then(() => next)
  operations.set(id, queued)
  try {
    await new AgentBrowserOperation(10_000).run(
      'waiting for the previous operation on tab ' + id,
      () => previous.catch(() => undefined),
      () => undefined,
      10_000,
    )
    return await operation(resolveAgentBrowserTab(projectPath, id, allowUnsupportedUrl))
  } finally {
    release()
    if (operations.get(id) === queued) operations.delete(id)
  }
}

export async function openAgentBrowserTab(projectPath: string, url: string, owner: WebContents, newTab = false) {
  const { app } = requireBrowserElectronRuntime()
  if (!app.isReady()) throw new Error('Browser automation requires the TideCode desktop application.')
  const target = requireBrowserUrl(url)
  const project = path.resolve(projectPath)
  if (!newTab) {
    const existing = [...tabs.values()].find((tab) =>
      tab.projectPath === project && tab.createdByAgent && !tab.contents.isDestroyed()
      && tab.ownerId === owner.id && tab.contents.getURL() === target)
    if (existing) {
      return {
        tab_id: existing.id, url: target,
        title: existing.contents.getTitle(), status: 'reused',
      }
    }
  }
  const agentCount = [...tabs.values()].filter((tab) =>
    tab.projectPath === project && tab.createdByAgent && !tab.contents.isDestroyed()).length
    + [...pendingOpen.values()].filter((pending) => pending.projectPath === project).length
  if (agentCount >= MAX_AGENT_TABS_PER_PROJECT) {
    throw new Error('Too many AI browser tabs. Close an existing tab before opening another.')
  }
  const id = randomUUID()
  const registered = new Promise<AgentBrowserTab>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingOpen.delete(id)
      reject(new Error('The TideCode browser panel did not attach the requested tab in time.'))
    }, 20_000)
    pendingOpen.set(id, { projectPath: project, resolve, reject, timeout })
  })
  const onOwnerDestroyed = () => {
    const pending = pendingOpen.get(id)
    if (!pending) return
    pendingOpen.delete(id)
    clearTimeout(pending.timeout)
    pending.reject(new Error('The TideCode browser window closed before attaching the tab.'))
  }
  owner.once('destroyed', onOwnerDestroyed)
  try {
    owner.send('browser:openAgentTab', { tabId: id, projectPath: project, url: target })
    const tab = await registered
    return { tab_id: id, url: tab.contents.getURL() || target, title: tab.contents.getTitle(), status: 'loaded' }
  } catch (error) {
    const pending = pendingOpen.get(id)
    if (pending) {
      pendingOpen.delete(id)
      clearTimeout(pending.timeout)
    }
    throw error
  } finally {
    owner.removeListener('destroyed', onOwnerDestroyed)
  }
}

export async function terminateAgentBrowserTab(projectPath: string, id: string) {
  return withAgentBrowserTab(projectPath, id, async (tab) => {
    const { webContents } = requireBrowserElectronRuntime()
    const owner = webContents.fromId(tab.ownerId)
    if (!owner || owner.isDestroyed()) throw new Error('The visible browser owner is no longer available.')
    owner.send('browser:terminateAgentTab', { tabId: tab.id, projectPath: tab.projectPath })
    // Renderer owns visible-tab state. It will unmount the corresponding webview.
    return { tab_id: id, status: 'close_requested' }
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
