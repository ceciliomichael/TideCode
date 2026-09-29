export interface RemoteBrowserState {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  screenshotDataUrl: string
  title: string
  url: string
}

export interface RemoteBrowserFrameEvent {
  projectKey: string
  tabId: string
  screenshotDataUrl: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export interface RemoteBrowserKeyInput {
  altKey: boolean
  code: string
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

export const BROWSER_DEVTOOLS_DOCK_MODES = ['right', 'bottom', 'undocked'] as const
export type BrowserDevToolsDockMode = (typeof BROWSER_DEVTOOLS_DOCK_MODES)[number]

export function isBrowserDevToolsDockMode(value: unknown): value is BrowserDevToolsDockMode {
  return typeof value === 'string' && BROWSER_DEVTOOLS_DOCK_MODES.includes(value as BrowserDevToolsDockMode)
}

export interface OpenBrowserDevToolsInput {
  bounds?: BrowserDevToolsBounds
  mode: BrowserDevToolsDockMode
  webContentsId: number
}

export interface BrowserDevToolsBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface BrowserDevToolsTargetInput {
  webContentsId: number
}

export interface BrowserDevToolsMenuAnchor {
  height: number
  width: number
  x: number
  y: number
}

export interface BrowserDevToolsMenuTheme {
  activeSurface: string
  background: string
  border: string
  brand: string
  foreground: string
  hoverSurface: string
  mutedForeground: string
}

export interface BrowserDevToolsMenuInput {
  anchor: BrowserDevToolsMenuAnchor
  mode: BrowserDevToolsDockMode
  theme: BrowserDevToolsMenuTheme
}

export interface SetBrowserDevToolsVisibilityInput extends BrowserDevToolsTargetInput {
  visible: boolean
}

export interface UpdateBrowserDevToolsBoundsInput extends BrowserDevToolsTargetInput {
  bounds: BrowserDevToolsBounds
}

export interface TideCodeBrowserDevToolsApi {
  close: (input: BrowserDevToolsTargetInput) => Promise<boolean>
  onClosed: (listener: (webContentsId: number) => void) => () => void
  onReady: (listener: (webContentsId: number) => void) => () => void
  onShortcut: (listener: (webContentsId: number) => void) => () => void
  open: (input: OpenBrowserDevToolsInput) => Promise<boolean>
  showDockMenu: (input: BrowserDevToolsMenuInput) => Promise<BrowserDevToolsDockMode | null>
  setVisible: (input: SetBrowserDevToolsVisibilityInput) => Promise<boolean>
  updateBounds: (input: UpdateBrowserDevToolsBoundsInput) => Promise<boolean>
}

export interface TideCodeBrowserApi {
  back: (projectKey: string, tabId: string) => Promise<RemoteBrowserState>
  capture: (projectKey: string, tabId: string) => Promise<RemoteBrowserState>
  close: (projectKey: string, tabId: string) => Promise<void>
  getSelectionText: (projectKey: string, tabId: string) => Promise<string>
  pointerDown: (projectKey: string, tabId: string, x: number, y: number) => Promise<void>
  pointerUp: (projectKey: string, tabId: string, x: number, y: number) => Promise<void>
  forward: (projectKey: string, tabId: string) => Promise<RemoteBrowserState>
  key: (projectKey: string, tabId: string, input: RemoteBrowserKeyInput) => Promise<void>
  movePointer: (projectKey: string, tabId: string, x: number, y: number, buttons: number) => Promise<string>
  navigate: (projectKey: string, tabId: string, url: string) => Promise<RemoteBrowserState>
  reload: (projectKey: string, tabId: string) => Promise<RemoteBrowserState>
  resize: (projectKey: string, tabId: string, width: number, height: number, deviceScaleFactor: number) => Promise<void>
  startScreencast: (projectKey: string, tabId: string, width: number, height: number, deviceScaleFactor: number) => Promise<RemoteBrowserState>
  stopScreencast: (projectKey: string, tabId: string) => Promise<void>
  onFrame: (listener: (event: RemoteBrowserFrameEvent) => void) => () => void
  typeText: (projectKey: string, tabId: string, text: string) => Promise<void>
  wheel: (projectKey: string, tabId: string, x: number, y: number, deltaX: number, deltaY: number) => Promise<void>
}
