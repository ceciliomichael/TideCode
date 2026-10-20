import type { WebContents } from 'electron'
import type { BrowserAnnotation } from '../history/browserAnnotations'
import { withBrowserProtocol } from './agentCdpSession'

export async function resolveBrowserAnnotationTargets(
  contents: WebContents,
  annotations: readonly BrowserAnnotation[],
): Promise<Array<{ annotation: BrowserAnnotation; status: 'resolved' | 'unresolved' }>> {
  if (!annotations.length) return []
  const inputs = annotations.slice(-100).map((entry) => ({
    selector: entry.selector,
    name: entry.elementName,
  }))
  const expression = '(() => { const inputs = ' + JSON.stringify(inputs)
    + '; return inputs.map(item => { try { const node = document.querySelector(item.selector);'
    + ' if (!node) return false; const actual = String(node.getAttribute("aria-label")'
    + ' || node.innerText || node.tagName.toLowerCase()).trim().slice(0,160);'
    + ' return actual === item.name; } catch { return false; } }); })()'
  const matches = await withBrowserProtocol(contents, async (send) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true }) as {
      result?: { value?: boolean[] }
    }
    return (result?.result?.value ?? []) as boolean[]
  })
  return annotations.slice(-100).map((annotation, index) => ({
    annotation,
    status: matches[index] ? 'resolved' : 'unresolved',
  }))
}
