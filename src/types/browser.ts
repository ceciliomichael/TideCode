export const BROWSER_SESSION_PARTITION = 'persist:tidecode-browser'
export const BROWSER_ZOOM_LEVELS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const

export interface BrowserUrlRequest {
  id: string
  url: string
  incognito: boolean
}

export interface BrowserDevToolsTargetInput {
  webContentsId: number
}

export interface BrowserPageFavicon {
  url: string
  faviconDataUrl: string
}

export interface TideCodeBrowserFaviconsApi {
  get: (webContentsId: number) => Promise<BrowserPageFavicon | null>
}

export interface TideCodeBrowserDevToolsApi {
  close: (input: BrowserDevToolsTargetInput) => Promise<boolean>
  onClosed: (listener: (webContentsId: number) => void) => () => void
  onShortcut: (listener: (webContentsId: number) => void) => () => void
  open: (input: BrowserDevToolsTargetInput) => Promise<boolean>
}

export interface TideCodeBrowserPageActionsApi {
  onAgentCursor: (listener: (input: { tabId: string; projectPath: string; width: number; height: number; cursor: AgentBrowserCursor }) => void) => () => void
  closeAgentTab: (input: { tabId: string; projectPath: string }) => Promise<void>
  getAgentFrame: (tabId: string) => AgentBrowserFrame | null
  onAgentFrame: (listener: (input: AgentBrowserFrame) => void) => () => void
  onUrlOpen: (listener: (request: BrowserUrlRequest) => void) => () => void
  onZoomRequest: (listener: (webContentsId: number, direction: 'in' | 'out') => void) => () => void
  onAgentTabOpen: (listener: (input: { tabId: string; projectPath: string; url: string }) => void) => () => void
  registerAgentTab: (input: { tabId: string; projectPath: string; webContentsId: number }) => Promise<void>
  onAgentTabTermination: (listener: (input: { tabId: string; projectPath: string }) => void) => () => void
  listAnnotations: (input: { conversationId: string; projectPath: string }) => Promise<BrowserElementAnnotation[]>
  saveAnnotation: (input: BrowserElementAnnotationDraft & { webContentsId: number }) => Promise<BrowserElementAnnotation>
  removeAnnotation: (input: { id: string; conversationId: string; projectPath: string }) => Promise<boolean>
  createIncognitoTab: (input: {
    projectKey: string
  }) => Promise<BrowserPrivateTab>
  releaseIncognitoTab: (input: { tabId: string }) => Promise<void>
  captureScreenshot: (
    input: BrowserDevToolsTargetInput & { projectPath: string },
  ) => Promise<BrowserScreenshot>
  screenshotAction: (
    input: BrowserScreenshot & { action: BrowserScreenshotAction },
  ) => Promise<void>
  getZoom: (input: BrowserDevToolsTargetInput) => Promise<number>
  setZoom: (
    input: BrowserDevToolsTargetInput & { percent: number },
  ) => Promise<number>
  clearCookies: (input: { partition: string }) => Promise<void>
  clearCache: (input: { partition: string }) => Promise<void>
}

export interface AgentBrowserFrame {
  tabId: string
  projectPath: string
  url: string
  title?: string
  faviconUrl?: string
  width: number
  height: number
  cursor: AgentBrowserCursor | null
  imageDataUrl: string
}

export interface AgentBrowserCursor {
  x: number
  y: number
  kind?: string
  effect?: 'click' | 'drag'
  revision?: number
  motionRevision?: number
}

export interface BrowserElementAnnotationDraft {
  conversationId: string
  projectPath: string
  tabId: string
  url: string
  selector: string
  elementName: string
  comment: string
}

export interface BrowserElementAnnotation extends BrowserElementAnnotationDraft {
  id: string
  createdAt: number
}

export interface BrowserPrivateTab {
  tabId: string
  partition: string
}

export interface BrowserScreenshot {
  projectPath: string
  filePath: string
}

export type BrowserScreenshotAction = 'copyPath' | 'reveal' | 'copyImage'
