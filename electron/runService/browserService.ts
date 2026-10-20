export type BrowserHostRequest =
  | { operation: 'open'; projectPath: string; url: string; newTab?: boolean }
  | { operation: 'tabs'; projectPath: string; page: number }
  | { operation: 'terminate'; projectPath: string; tabId: string }
  | { operation: 'interact'; projectPath: string; tabId: string; action: {
      action: string
      [key: string]: unknown
    } }
  | { operation: 'read'; projectPath: string; tabId: string; view: 'combined' | 'visual' | 'structure' | 'annotations'; offset: number; limit: number; conversationId: string | null; includeAnnotations: boolean }
  | { operation: 'devtools'; projectPath: string; tabId: string; input: {
      action: string
      [key: string]: unknown
    } }

export interface BrowserHostResponse {
  data: Record<string, unknown>
  imageBase64?: string
}

type BrowserHostHandler = (request: BrowserHostRequest) => Promise<BrowserHostResponse>
let handler: BrowserHostHandler | null = null

/** Run service routes AI browser calls through an authorized desktop host. */
export function setRunServiceBrowserHandler(next: BrowserHostHandler | null) {
  handler = next
}

export async function requestTideCodeBrowser(input: BrowserHostRequest): Promise<BrowserHostResponse> {
  if (!handler) {
    throw new Error('TideCode browser automation requires the desktop browser host. Open TideCode Desktop and reconnect the run service.')
  }
  return handler(input)
}
