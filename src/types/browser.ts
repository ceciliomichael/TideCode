export const BROWSER_SESSION_PARTITION = 'persist:tidecode-browser'
export const BROWSER_ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500] as const

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
  captureScreenshot: (input: BrowserDevToolsTargetInput & { projectPath: string }) => Promise<BrowserScreenshot>
  screenshotAction: (input: BrowserScreenshot & { action: BrowserScreenshotAction }) => Promise<void>
  getZoom: (input: BrowserDevToolsTargetInput) => Promise<number>
  setZoom: (input: BrowserDevToolsTargetInput & { percent: number }) => Promise<number>
  clearCookies: () => Promise<void>
  clearCache: () => Promise<void>
}

export interface BrowserScreenshot {
  projectPath: string
  filePath: string
}

export type BrowserScreenshotAction = 'copyPath' | 'reveal' | 'copyImage'
