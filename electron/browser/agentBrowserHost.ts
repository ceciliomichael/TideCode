import type { WebContents } from 'electron'
import {
  listAgentBrowserTabs,
  openAgentBrowserTab,
  terminateAgentBrowserTab,
  withAgentBrowserTab,
} from './agentTabs'
import { captureAgentPageInViewport, withAgentViewport } from './agentPageCapture'
import { rememberAgentViewport, resolveAgentViewport } from './agentViewport'
import { formatBrowserElements, readBrowserStructureInViewport } from './agentPageStructure'
import { interactWithAgentPage, type AgentBrowserInteraction } from './agentPageInput'
import { readBrowserDiagnostics, type BrowserDiagnosticRequest } from './agentPageDiagnostics'
import { resolveBrowserAnnotationTargets } from './agentAnnotations'
import { formatBrowserAnnotations, listBrowserAnnotations } from '../history/browserAnnotations'
import type { BrowserHostRequest, BrowserHostResponse } from '../runService/browserService'

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

export async function executeDesktopBrowserRequest(
  request: BrowserHostRequest,
  owner: WebContents | null,
): Promise<BrowserHostResponse> {
  if (!request || typeof request.projectPath !== 'string' || !request.projectPath.trim()) {
    throw new Error('Browser operation requires an active project.')
  }
  const workspace = request.projectPath
  if (request.operation === 'open') {
    if (!owner || owner.isDestroyed()) {
      throw new Error('The desktop browser window is not available.')
    }
    return { data: await openAgentBrowserTab(workspace, request.url, owner, request.newTab === true) }
  }
  if (request.operation === 'tabs') {
    return { data: listAgentBrowserTabs(workspace, request.page) }
  }
  if (request.operation === 'terminate') {
    return { data: await terminateAgentBrowserTab(workspace, request.tabId) }
  }
  if (request.operation === 'interact') {
    const action = request.action as AgentBrowserInteraction
    if (!action || typeof action.action !== 'string') throw new Error('Invalid browser interaction.')
    const data = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      interactWithAgentPage(tab.contents, action))
    return { data }
  }
  if (request.operation === 'devtools') {
    const input = request.input as BrowserDiagnosticRequest
    if (!input || typeof input.action !== 'string') throw new Error('Invalid browser diagnostic request.')
    const output = await withAgentBrowserTab(workspace, request.tabId, (tab) =>
      readBrowserDiagnostics(tab.contents, workspace, input))
    return { data: { output } }
  }
  if (request.operation === 'read') {
    const { view, offset, limit } = request
    const viewport = resolveAgentViewport(request)
    if (!['combined', 'visual', 'structure', 'annotations'].includes(view)) {
      throw new Error('Unknown browser read mode.')
    }
    const result = await withAgentBrowserTab(workspace, request.tabId, async (tab) => {
      const page = await withAgentViewport(tab.contents, async (send) => {
        const png = view === 'combined' || view === 'visual'
          ? await captureAgentPageInViewport(send, viewport)
          : null
        const structure = view === 'combined' || view === 'structure'
          ? await readBrowserStructureInViewport(tab.contents, send, offset, limit, viewport)
          : null
        return { png, structure, url: tab.contents.getURL(), title: tab.contents.getTitle() }
      }, viewport)
      if (page.png && page.png.length > MAX_SCREENSHOT_BYTES) {
        throw new Error('Browser screenshot exceeds the allowed image size.')
      }
      rememberAgentViewport(tab.contents, viewport)
      return page
    })
    const annotations = (request.includeAnnotations || view === 'annotations') && request.conversationId
      ? await listBrowserAnnotations(request.conversationId, workspace)
      : []
    const onPage = annotations.filter((annotation) => annotation.url === result.url)
    const resolvedAnnotations = onPage.length
      ? await withAgentBrowserTab(workspace, request.tabId, (tab) =>
        resolveBrowserAnnotationTargets(tab.contents, onPage))
      : []
    const label = 'Tab: ' + request.tabId + '\nURL: ' + result.url
      + '\nViewport: ' + viewport.width + 'x' + viewport.height
    const details = [
      label,
      'Title: ' + (result.title || 'Untitled'),
      ...(result.structure ? [
        formatBrowserElements(result.structure.elements, result.structure.total, offset),
        ...(result.structure.pageText.length ? [
          '## Page text',
          result.structure.pageText.map((line) => '- ' + line.replace(/[<>]/gu, '')).join('\n'),
        ] : []),
      ] : []),
      ...(resolvedAnnotations.length ? [
        '## Browser annotations',
        formatBrowserAnnotations(resolvedAnnotations.map((item) => item.annotation)),
        resolvedAnnotations.map((item) => item.annotation.id + ': ' + item.status).join('\n'),
      ] : []),
    ].join('\n\n')
    return {
      data: {
        tab_id: request.tabId, body: details, url: result.url,
        width: viewport.width, height: viewport.height,
      },
      ...(result.png ? { imageBase64: result.png.toString('base64') } : {}),
    }
  }
  throw new Error('Unsupported TideCode browser operation.')
}
