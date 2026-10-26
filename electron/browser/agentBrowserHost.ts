import type { WebContents } from 'electron'
import {
  listAgentBrowserTabs,
  openAgentBrowserTab,
  resolveAgentBrowserTab,
  terminateAgentBrowserTab,
  withAgentBrowserTab,
  type AgentBrowserTab,
  getAgentTabFavicon,
} from './agentTabs'
import { captureAgentPageInViewport, withAgentViewport } from './agentPageCapture'
import { getAgentViewport, rememberAgentViewport, resolveAgentViewport, type AgentViewport } from './agentViewport'
import { formatBrowserElements, readBrowserStructureInViewport } from './agentPageStructure'
import { interactWithAgentPage, interactWithAgentPageInViewport, type AgentBrowserInteraction } from './agentPageInput'
import { navigateAgentPage } from './agentPageNavigation'
import { executeAgentBrowserSequence, executeAgentBrowserSequenceInViewport } from './agentPageSequence'
import { readBrowserDiagnostics, type BrowserDiagnosticRequest } from './agentPageDiagnostics'
import { resolveBrowserAnnotationTargets } from './agentAnnotations'
import { getAgentCursor } from './agentCursor'
import { rememberAgentObservation } from './agentObservation'
import { requireBrowserElectronRuntime } from './agentElectronRuntime'
import { withBrowserTabAccess } from './agentTabAccess'
import { withBrowserProtocol } from './agentCdpSession'
import { AgentBrowserOperation } from './agentBrowserOperation'
import { formatBrowserAnnotations, listBrowserAnnotations } from '../history/browserAnnotations'
import type { BrowserHostRequest, BrowserHostResponse } from '../runService/browserService'

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

function requireAgentOwnedBrowserTarget(projectPath: string, tabId: string) {
  if (resolveAgentBrowserTab(projectPath, tabId, true).kind !== 'agent') {
    throw new Error('This tab is user-owned and read-only to the AI. Open an AI-owned tab to interact with or close a page.')
  }
}

async function runOnBrowserSurface<T>(
  tab: AgentBrowserTab,
  action: Parameters<typeof withAgentViewport<T>>[1],
  viewport: AgentViewport,
  signal?: AbortSignal,
) {
  if (tab.kind === 'agent') return withAgentViewport(tab.contents, action, viewport, signal)
  return withBrowserProtocol(tab.contents, (send) => action(send, viewport), new AgentBrowserOperation(20_000, signal))
}

async function browserViewport(tab: AgentBrowserTab, requested?: AgentViewport): Promise<AgentViewport> {
  if (tab.kind === 'agent') return resolveAgentViewport(requested ?? getAgentViewport(tab.contents))
  const dimensions = await tab.contents.executeJavaScript('({width: window.innerWidth, height: window.innerHeight})')
  const measured = resolveAgentViewport(dimensions)
  const previous = getAgentViewport(tab.contents)
  // Attaching the CDP debugger can shift the reported CSS viewport by up to
  // two pixels without a meaningful user resize. Keep observation coordinates
  // stable across that transition, but invalidate them on actual size changes.
  if (Math.abs(measured.width - previous.width) <= 2
    && Math.abs(measured.height - previous.height) <= 2) {
    return previous
  }
  return measured
}

function publishAgentFrame(tab: AgentBrowserTab, viewport: AgentViewport, image: Buffer) {
  if (tab.kind !== 'agent') return
  const { webContents } = requireBrowserElectronRuntime()
  const owner = webContents.fromId(tab.ownerId)
  if (!owner || owner.isDestroyed()) return
  owner.send('browser:agentFrame', {
    tabId: tab.id, projectPath: tab.projectPath, url: tab.contents.getURL(),
    title: tab.contents.getTitle(),
    faviconUrl: getAgentTabFavicon(tab.contents),
    width: viewport.width, height: viewport.height,
    cursor: getAgentCursor(tab.contents),
    imageDataUrl: 'data:image/png;base64,' + image.toString('base64'),
  })
}

async function publishAgentPreview(projectPath: string, tabId: string) {
  await withAgentBrowserTab(projectPath, tabId, async (tab) => {
    if (tab.kind !== 'agent') return
    try {
      const viewport = getAgentViewport(tab.contents)
      const image = await withAgentViewport(tab.contents, (send) => captureAgentPageInViewport(send, viewport), viewport)
      publishAgentFrame(tab, viewport, image)
    } catch {
      // The visual preview is optional; do not turn a completed interaction into a failure.
    }
  })
}

export async function executeDesktopBrowserRequest(
  request: BrowserHostRequest,
  owner: WebContents | null,
  signal?: AbortSignal,
): Promise<BrowserHostResponse> {
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  if (!request || typeof request.projectPath !== 'string' || !request.projectPath.trim()) {
    throw new Error('Browser operation requires an active project.')
  }
  const workspace = request.projectPath
  if (request.operation === 'open') {
    if (!owner || owner.isDestroyed()) {
      throw new Error('The desktop browser window is not available.')
    }
    const viewport = resolveAgentViewport(request)
    const data = await openAgentBrowserTab(workspace, request.url, owner, request.newTab === true, signal, viewport)
    owner.send('browser:openAgentTab', { tabId: data.tab_id, projectPath: workspace, url: data.url })
    void publishAgentPreview(workspace, data.tab_id).catch(() => undefined)
    return { data }
  }
  if (request.operation === 'tabs') {
    return { data: listAgentBrowserTabs(workspace, request.page) }
  }
  if (request.operation === 'terminate') {
    requireAgentOwnedBrowserTarget(workspace, request.tabId)
    return { data: await terminateAgentBrowserTab(workspace, request.tabId) }
  }
  if (request.operation === 'interact') {
    requireAgentOwnedBrowserTarget(workspace, request.tabId)
    const action = request.action as AgentBrowserInteraction
    if (!action || typeof action.action !== 'string') throw new Error('Invalid browser interaction.')
    const data = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      withBrowserTabAccess(tab, signal, async (activeSignal) => {
        if (tab.kind === 'agent') return interactWithAgentPage(tab.contents, action, activeSignal)
        const viewport = await browserViewport(tab)
        return runOnBrowserSurface(tab, async (send) => {
          await interactWithAgentPageInViewport(tab.contents, action, send, viewport, activeSignal)
          return { action: action.action, url: tab.contents.getURL(), loading: tab.contents.isLoading() }
        }, viewport, activeSignal)
      }), false, signal)
    if (!signal?.aborted) {
      void publishAgentPreview(workspace, request.tabId).catch(() => undefined)
    }
    return { data }
  }
  if (request.operation === 'navigate') {
    requireAgentOwnedBrowserTarget(workspace, request.tabId)
    if (request.input.action === 'stop') {
      const tab = resolveAgentBrowserTab(workspace, request.tabId)
      return { data: await navigateAgentPage(tab.contents, request.input, signal) }
    }
    const data = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      withBrowserTabAccess(tab, signal, (activeSignal) =>
        navigateAgentPage(tab.contents, request.input, activeSignal)), false, signal)
    if (!signal?.aborted) {
      void publishAgentPreview(workspace, request.tabId).catch(() => undefined)
    }
    return { data }
  }
  if (request.operation === 'sequence') {
    requireAgentOwnedBrowserTarget(workspace, request.tabId)
    const { captures, ...data } = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      withBrowserTabAccess(tab, signal, async (activeSignal) => {
        if (tab.kind === 'agent') return executeAgentBrowserSequence(tab.contents, request.steps, activeSignal)
        const viewport = await browserViewport(tab)
        return runOnBrowserSurface(tab, (send) =>
          executeAgentBrowserSequenceInViewport(tab.contents, request.steps, send, viewport, activeSignal),
        viewport, activeSignal)
      }), false, signal)
    if (!signal?.aborted) {
      void publishAgentPreview(workspace, request.tabId).catch(() => undefined)
    }
    return { data, captures }
  }
  if (request.operation === 'devtools') {
    if (resolveAgentBrowserTab(workspace, request.tabId).kind === 'visible'
      && !['console', 'network', 'performance'].includes(request.input.action)) {
      throw new Error('User-owned tabs are read-only. JavaScript evaluation and custom CDP commands are available only in AI-owned tabs.')
    }
    const input = request.input as BrowserDiagnosticRequest
    if (!input || typeof input.action !== 'string') throw new Error('Invalid browser diagnostic request.')
    const output = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      withBrowserTabAccess(tab, signal, (activeSignal) =>
        readBrowserDiagnostics(tab.contents, workspace, input, activeSignal)), false, signal)
    return { data: { output } }
  }
  if (request.operation === 'read') {
    const { view, offset, limit } = request
    if (!['combined', 'visual', 'structure', 'annotations'].includes(view)) {
      throw new Error('Unknown browser read mode.')
    }
    const result = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      withBrowserTabAccess(tab, signal, async (activeSignal) => {
      const existing = getAgentViewport(tab.contents)
      const requestedViewport = request.width === undefined && request.height === undefined
        ? undefined
        : resolveAgentViewport({
          width: request.width ?? existing.width,
          height: request.height ?? existing.height,
        })
      const viewport = await browserViewport(tab, requestedViewport)
      const page = await runOnBrowserSurface(tab, async (send) => {
        const png = view === 'combined' || view === 'visual'
          ? await captureAgentPageInViewport(send, viewport)
          : null
        const structure = view === 'combined' || view === 'structure'
          ? await readBrowserStructureInViewport(tab.contents, send, offset, limit, viewport)
          : null
        const observationId = rememberAgentObservation(tab.contents, viewport)
        return { png, structure, observationId, url: tab.contents.getURL(), title: tab.contents.getTitle() }
      }, viewport, activeSignal)
      if (page.png && page.png.length > MAX_SCREENSHOT_BYTES) {
        throw new Error('Browser screenshot exceeds the allowed image size.')
      }
      rememberAgentViewport(tab.contents, viewport)
      return { ...page, viewport, kind: tab.kind }
    }), false, signal)
    if (signal?.aborted) throw new Error('Browser operation cancelled.')
    if (result.png) {
      try {
        publishAgentFrame(resolveAgentBrowserTab(workspace, request.tabId), result.viewport, result.png)
      } catch {
        // A closed tab should not invalidate a successful read result.
      }
    }
    const annotations = (request.includeAnnotations || view === 'annotations') && request.conversationId
      ? await listBrowserAnnotations(request.conversationId, workspace)
      : []
    const onPage = annotations.filter((annotation) => annotation.url === result.url)
    const resolvedAnnotations = onPage.length
      ? await withAgentBrowserTab(workspace, request.tabId, (tab) =>
        withBrowserTabAccess(tab, signal, () =>
          resolveBrowserAnnotationTargets(tab.contents, onPage)))
      : []
    const safeLine = (value: string) => value.replace(/[\r\n]/gu, ' ').slice(0, 1000)
    const details = [
      'Browser read',
      'Ownership: ' + (result.kind === 'agent' ? 'AI-owned' : 'User-owned (read-only)'),
      'Title: ' + safeLine(result.title || 'Untitled'),
      'URL: ' + safeLine(result.url),
      'Viewport: ' + result.viewport.width + ' × ' + result.viewport.height,
      'Read mode: ' + view,
      'Elements found: ' + (result.structure ? result.structure.total : 'Not inspected'),
      'Result: Page inspected',
      ...(result.structure ? [
        '',
        formatBrowserElements(result.structure.elements, result.structure.total, offset),
        ...(result.structure.pageText.length ? [
          'Page text:',
          result.structure.pageText.map((line) => line.replace(/[\r\n]/gu, ' ')).join('\n'),
        ] : []),
      ] : []),
      ...(resolvedAnnotations.length ? [
        '',
        'Browser annotations:',
        formatBrowserAnnotations(resolvedAnnotations.map((item) => item.annotation)),
        resolvedAnnotations.map((item) => item.annotation.id + ': ' + item.status).join('\n'),
      ] : []),
    ].join('\n')
    return {
      data: {
        tab_id: request.tabId, body: details, url: result.url, observation_id: result.observationId,
        width: result.viewport.width, height: result.viewport.height,
      },
      ...(result.png ? { imageBase64: result.png.toString('base64') } : {}),
    }
  }
  throw new Error('Unsupported TideCode browser operation.')
}
