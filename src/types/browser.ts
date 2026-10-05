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

export interface BrowserPageFavicon {
  url: string
  faviconDataUrl: string
}

export interface TideCodeBrowserFaviconsApi {
  get: (webContentsId: number) => Promise<BrowserPageFavicon | null>
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
