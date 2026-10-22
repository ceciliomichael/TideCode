import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { withAgentViewport } from './agentPageCapture'
import type { CdpSend } from './agentCdpSession'
import { getAgentViewport, type AgentViewport } from './agentViewport'

export interface BrowserElement {
  ref: string
  tag: string
  role: string
  name: string
  x: number | null
  y: number | null
}

interface Snapshot {
  token: string
  url: string
  elements: Map<string, { backendId: number; name: string }>
}
interface SnapshotDocument {
  scrollOffsetX?: number
  scrollOffsetY?: number
  nodes?: { nodeName?: number[]; backendNodeId?: number[]; attributes?: number[][] }
  layout?: { nodeIndex?: number[]; bounds?: number[][] }
}
interface SnapshotResponse {
  documents: SnapshotDocument[]
  strings: string[]
}
interface AccessibilityResponse {
  nodes?: Array<{ backendDOMNodeId?: number; role?: { value?: string }; name?: { value?: string } }>
}
interface LayoutMetricsResponse {
  visualViewport: { clientHeight: number }
  cssVisualViewport: { clientHeight: number }
}

const snapshots = new Map<number, Snapshot>()
const snapshotOwners = new WeakSet<WebContents>()
const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SUMMARY', 'LABEL', 'DETAILS'])
const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch', 'slider', 'option', 'searchbox', 'spinbutton'])

const ACTIONABLE_POINT_PROBE = `function() {
  if(!this.isConnected) return {error:"Element is no longer attached. Read the page again."};
  this.scrollIntoView({behavior:"instant",block:"center",inline:"nearest"});
  const r=this.getBoundingClientRect(),s=getComputedStyle(this);
  if(r.width<1||r.height<1||s.visibility==="hidden"||s.display==="none"||s.pointerEvents==="none")
    return {error:"Element is not actionable"};
  const left=Math.max(r.left,0),right=Math.min(r.right,innerWidth);
  const top=Math.max(r.top,0),bottom=Math.min(r.bottom,innerHeight);
  if(left>=right||top>=bottom) return {error:"Element is outside the viewport"};
  const points=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  const editable=this.isContentEditable||this.tagName==="TEXTAREA"||
    (this.tagName==="INPUT"&&!["checkbox","radio","submit","button","file","hidden"].includes(this.type));
  for(const [fx,fy] of points){
    const x=left+(right-left)*fx,y=top+(bottom-top)*fy;
    const target=document.elementFromPoint(x,y);
    if(target&&(target===this||this.contains(target)||this.shadowRoot?.contains(target)))
      return {x,y,tag:this.tagName,disabled:!!this.disabled,editable};
  }
  const blocker=document.elementFromPoint(left+(right-left)/2,top+(bottom-top)/2);
  return {error:"Element is obscured by "+(blocker?.tagName?.toLowerCase()||"another element")+
    (blocker?.getAttribute("role")?" ["+blocker.getAttribute("role")+"]":"")+
    ". Dismiss the overlay or select an unobscured element."};
}`

function clean(value: string, limit = 160) {
  return value.replace(/[\r\n\t|]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit)
}

export function formatBrowserElements(elements: BrowserElement[], total: number, start: number) {
  const lines = ['| Reference | Role | Name | Position |', '| --- | --- | --- | --- |']
  for (const el of elements) {
    lines.push('| ' + el.ref + ' | ' + (el.role || el.tag.toLowerCase()) + ' | '
      + clean(el.name) + ' | ' + (el.x === null ? 'Off-screen' : Math.round(el.x) + ',' + Math.round(el.y ?? 0)) + ' |')
  }
  lines.push('Elements ' + (elements.length ? start + 1 : 0) + '-' + (start + elements.length)
    + ' of ' + total + '. References are scoped to this read and expire on subsequent structure reads or navigation.')
  return lines.join('\n')
}

export async function readBrowserStructure(contents: WebContents, offset = 0, limit = 80) {
  return withAgentViewport(contents, (send) => readBrowserStructureInViewport(contents, send, offset, limit))
}

export async function readBrowserStructureInViewport(contents: WebContents, send: CdpSend, offset = 0, limit = 80, viewport: AgentViewport = getAgentViewport(contents)) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Structure offset must be nonnegative, and limit must be between 1 and 200.')
  }
  const [snapshotResult, accessibilityResult, metricsResult] = await Promise.allSettled([
    send('DOMSnapshot.captureSnapshot', { computedStyles: [], includeDOMRects: true }),
    send('Accessibility.getFullAXTree', { depth: 12 }),
    send('Page.getLayoutMetrics'),
  ])
  if (snapshotResult.status === 'rejected') {
    throw snapshotResult.reason
  }
  if (accessibilityResult.status === 'rejected') {
    throw accessibilityResult.reason
  }
  if (metricsResult.status === 'rejected') {
    throw metricsResult.reason
  }
  const { documents, strings } = snapshotResult.value as SnapshotResponse
  const ax = accessibilityResult.value as AccessibilityResponse
  const metrics = metricsResult.value as LayoutMetricsResponse
  // DOMSnapshot bounds and scroll offsets use device-independent pixels,
  // which differ from input/screenshot CSS pixels on scaled Windows displays.
  const coordinateScale = metrics.visualViewport.clientHeight / metrics.cssVisualViewport.clientHeight
  if (!Number.isFinite(coordinateScale) || coordinateScale <= 0) {
    throw new Error('Chromium returned invalid viewport coordinates.')
  }
  const axByBackendId = new Map<number, { role: string; name: string }>()
  for (const node of ax.nodes ?? []) {
    if (!node.backendDOMNodeId) continue
    axByBackendId.set(node.backendDOMNodeId, {
      role: clean(String(node.role?.value ?? '')),
      name: clean(String(node.name?.value ?? '')),
    })
  }
  const pageText: string[] = []
  const seenText = new Set<string>()
  if (offset === 0) {
    for (const node of ax.nodes ?? []) {
      const role = String(node.role?.value ?? '')
      if (!['StaticText', 'heading', 'paragraph'].includes(role)) continue
      const name = clean(String(node.name?.value ?? ''), 250)
      if (!name || seenText.has(name)) continue
      seenText.add(name)
      pageText.push(name)
      if (pageText.length >= 50) break
    }
  }
  const list: BrowserElement[] = []
  const token = randomUUID().slice(0, 8)
  const elements = new Map<string, { backendId: number; name: string }>()
  const seen = new Set<number>()
  // Coordinates for nested iframe documents use their own frame origins.
  // Exclude them rather than offering misleading top-level click coordinates.
  for (const doc of (documents ?? []).slice(0, 1)) {
    const nodes = doc.nodes
    if (!nodes) continue
    const positions = new Map<number, { x: number; y: number }>()
    const layoutIndices = doc.layout?.nodeIndex ?? []
    const layoutBounds = doc.layout?.bounds ?? []
    for (let i = 0; i < layoutIndices.length; i++) {
      const bounds = layoutBounds[i]
      const nodeIndex = layoutIndices[i]
      if (!bounds || nodeIndex === undefined) continue
      const left = Math.max(0, (bounds[0] - (doc.scrollOffsetX ?? 0)) / coordinateScale)
      const right = Math.min(viewport.width, (bounds[0] + bounds[2] - (doc.scrollOffsetX ?? 0)) / coordinateScale)
      const top = Math.max(0, (bounds[1] - (doc.scrollOffsetY ?? 0)) / coordinateScale)
      const bottom = Math.min(viewport.height, (bounds[1] + bounds[3] - (doc.scrollOffsetY ?? 0)) / coordinateScale)
      if (left < right && top < bottom) {
        positions.set(nodeIndex, { x: (left + right) / 2, y: (top + bottom) / 2 })
      }
    }
    const nodeNames = nodes.nodeName ?? []
    for (let i = 0; i < nodeNames.length; i++) {
      const backendId = nodes.backendNodeId?.[i] ?? 0
      if (!backendId || seen.has(backendId)) continue
      const tag = String(strings[nodeNames[i]] ?? '').toUpperCase()
      const attrs: Record<string, string> = {}
      const pairs: number[] = nodes.attributes?.[i] ?? []
      for (let j = 0; j + 1 < pairs.length; j += 2) {
        attrs[String(strings[pairs[j]] ?? '')] = String(strings[pairs[j + 1]] ?? '')
      }
      const axNode = axByBackendId.get(backendId)
      const role = attrs.role || axNode?.role || ''
      const visible = positions.get(i)
      const interactive = INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(role)
        || attrs.tabindex !== undefined || attrs.contenteditable === 'true'
      if (!interactive) continue
      seen.add(backendId)
      const ref = 'el-' + token + '-' + backendId
      const name = clean(axNode?.name || attrs['aria-label'] || attrs.placeholder
        || attrs.title || attrs.alt || attrs.name || '')
      elements.set(ref, { backendId, name })
      list.push({
        ref, tag, role, name,
        x: visible?.x ?? null,
        y: visible?.y ?? null,
      })
      if (list.length >= 1200) break
    }
    if (list.length >= 1200) break
  }
  if (!snapshotOwners.has(contents)) {
    snapshotOwners.add(contents)
    contents.once('destroyed', () => snapshots.delete(contents.id))
  }
  snapshots.set(contents.id, { token, url: contents.getURL(), elements })
  return {
    elements: list.slice(offset, offset + limit),
    total: list.length,
    offset,
    has_more: offset + limit < list.length,
    pageText,
  }
}

export async function locateBrowserElement(contents: WebContents, ref: string, send: CdpSend) {
  const viewport = getAgentViewport(contents)
  const snapshot = snapshots.get(contents.id)
  if (!snapshot || snapshot.url !== contents.getURL()) {
    throw new Error('Element references are stale. Run browser.read with view "structure" or "combined" again.')
  }
  const element = snapshot.elements.get(ref)
  if (!element) throw new Error('Unknown or stale element reference. Read the page structure again.')
  const resolved = await send('DOM.resolveNode', { backendNodeId: element.backendId }) as { object?: { objectId?: string } }
  const objectId = resolved?.object?.objectId
  if (!objectId) throw new Error('Element is no longer attached. Read the page again.')
  try {
    const result = await send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: ACTIONABLE_POINT_PROBE,
      returnByValue: true,
    }) as { result?: { value?: unknown } }
    const found = result?.result?.value as { x?: number; y?: number; tag?: string; disabled?: boolean; editable?: boolean; error?: string } | undefined
    if (found?.error) throw new Error(found.error)
    if (found?.disabled || typeof found?.x !== 'number' || typeof found?.y !== 'number'
      || found.x < 0 || found.x >= viewport.width || found.y < 0 || found.y >= viewport.height) {
      throw new Error('Element cannot be interacted with. Read the page again.')
    }
    return { x: found.x, y: found.y, tag: found.tag ?? '', editable: !!found.editable, name: element.name }
  } finally {
    await send('Runtime.releaseObject', { objectId }).catch(() => undefined)
  }
}

export function clearBrowserStructure(contents: WebContents) {
  snapshots.delete(contents.id)
}
