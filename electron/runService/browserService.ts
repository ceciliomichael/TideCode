import type { AgentBrowserStep, BrowserSequenceCapture } from '../browser/agentPageSequence'

export type BrowserHostRequest =
  | { operation: 'open'; projectPath: string; url: string; newTab?: boolean; width?: number; height?: number }
  | { operation: 'tabs'; projectPath: string; page: number }
  | { operation: 'terminate'; projectPath: string; tabId: string }
  | { operation: 'sequence'; projectPath: string; tabId: string; steps: AgentBrowserStep[] }
  | { operation: 'interact'; projectPath: string; tabId: string; action: {
      action: string
      [key: string]: unknown
    } }
  | { operation: 'navigate'; projectPath: string; tabId: string; input: import('../browser/agentPageNavigation').BrowserNavigationInput }
  | { operation: 'read'; projectPath: string; tabId: string; width?: number; height?: number; view: 'combined' | 'visual' | 'structure' | 'annotations'; offset: number; limit: number; conversationId: string | null; includeAnnotations: boolean }
  | { operation: 'devtools'; projectPath: string; tabId: string; input: {
      action: string
      [key: string]: unknown
    } }

export interface BrowserHostResponse {
  data: Record<string, unknown>
  imageBase64?: string
  captures?: BrowserSequenceCapture[]
}

type BrowserHostHandler = (request: BrowserHostRequest, signal?: AbortSignal) => Promise<BrowserHostResponse>
let handler: BrowserHostHandler | null = null

/** Run service routes AI browser calls through an authorized desktop host. */
export function setRunServiceBrowserHandler(next: BrowserHostHandler | null) {
  handler = next
}

export async function requestTideCodeBrowser(input: BrowserHostRequest, signal?: AbortSignal): Promise<BrowserHostResponse> {
  if (!handler) {
    throw new Error('TideCode browser automation requires the desktop browser host. Open TideCode Desktop and reconnect the run service.')
  }
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  return handler(input, signal)
}
