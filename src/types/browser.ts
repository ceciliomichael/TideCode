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
