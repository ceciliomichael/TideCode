import {
  BrowserWindow,
  screen,
  shell,
  WebContentsView,
  type Rectangle,
  type WebContents,
  type BrowserWindowConstructorOptions,
} from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getStoredSettings } from '../settings/store'
import { serializeInitialSettingsArg } from '../settings/bootstrap'
import { serializeTideCodeLaunchRequest, type TideCodeLaunchRequest } from '../../src/lib/appLaunchRequest'
import { applyTideCodeAppIcon, getTideCodeAppIconPath } from './branding'
import { browserFaviconCache } from '../browser/faviconCache'
import { readWindowState, type TideCodeWindowState } from './windowState'
import {
  applyWindowTheme,
  getTitleBarOverlay,
  getWindowBackgroundColor,
  syncNativeThemeSource,
} from './theme'
import type { BrowserDevToolsDockMode } from '../../src/types/browser'

const MIN_WINDOW_WIDTH = 900
const MIN_WINDOW_HEIGHT = 600
const DEFAULT_WINDOW_WIDTH = 1440
const DEFAULT_WINDOW_HEIGHT = 900
const WINDOW_SCREEN_MARGIN = 32
const browserGuestDevToolsModes = new Map<number, BrowserDevToolsDockMode>()
const browserGuestDevToolsTransitions = new Set<number>()
const EMBEDDED_BROWSER_POINTER_FOCUS_SCRIPT = `
(() => {
  const root = document.documentElement
  if (!root || root.dataset.tidecodeFocusTracking === 'true') return

  root.dataset.tidecodeFocusTracking = 'true'
  const properties = [
    'outline',
    'outline-offset',
    'box-shadow',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
  ]
  let activeOverrides = []

  const restoreOverrides = () => {
    for (const entry of activeOverrides) {
      if (!entry.element?.style) continue
      for (const original of entry.originals) {
        if (original.value) {
          entry.element.style.setProperty(original.property, original.value, original.priority)
        } else {
          entry.element.style.removeProperty(original.property)
        }
      }
    }
    activeOverrides = []
  }

  addEventListener('pointerdown', (event) => {
    const snapshot = []
    for (const candidate of event.composedPath()) {
      if (!(candidate instanceof HTMLElement || candidate instanceof SVGElement)) continue
      const computed = getComputedStyle(candidate)
      snapshot.push({
        element: candidate,
        values: properties.map((property) => [property, computed.getPropertyValue(property)]),
      })
    }

    restoreOverrides()
    requestAnimationFrame(() => {
      activeOverrides = snapshot.map(({ element, values }) => {
        const originals = values.map(([property]) => ({
          property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        }))
        for (const [property, value] of values) {
          element.style.setProperty(property, value, 'important')
        }
        return { element, originals }
      })
    })
  }, true)

  addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      restoreOverrides()
    }
  }, true)
  addEventListener('blur', restoreOverrides, true)
})()
`

interface BrowserGuestDevToolsViewEntry {
  ownerWindow: BrowserWindow
  ready: boolean
  visible: boolean
  view: WebContentsView
}

const browserGuestDevToolsViews = new Map<number, BrowserGuestDevToolsViewEntry>()

function normalizeBrowserDevToolsBounds(bounds: Rectangle): Rectangle {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
}

function destroyBrowserGuestDevToolsView(guestWebContentsId: number) {
  const entry = browserGuestDevToolsViews.get(guestWebContentsId)
  if (!entry) {
    return
  }

  browserGuestDevToolsViews.delete(guestWebContentsId)
  try {
    entry.ownerWindow.contentView.removeChildView(entry.view)
  } catch {
    // The owner window may already be closing.
  }
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close()
  }
}

function notifyBrowserGuestDevToolsReady(guestWebContentsId: number) {
  const entry = browserGuestDevToolsViews.get(guestWebContentsId)
  if (!entry || entry.ownerWindow.isDestroyed()) {
    return
  }

  entry.ready = true
  if (entry.visible) {
    entry.view.setVisible(true)
  }
  entry.ownerWindow.webContents.send('browser:devToolsReady', guestWebContentsId)
}

async function closeDevToolsForTransition(guestWebContents: WebContents) {
  if (!guestWebContents.isDevToolsOpened()) {
    return
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout)
      guestWebContents.off('devtools-closed', finish)
      resolve()
    }
    const timeout = setTimeout(finish, 250)
    guestWebContents.once('devtools-closed', finish)
    guestWebContents.closeDevTools()
  })
}

export async function openBrowserGuestDevTools(
  guestWebContents: WebContents,
  mode: BrowserDevToolsDockMode,
  ownerWindow: BrowserWindow,
  bounds?: Rectangle,
) {
  const previousMode = browserGuestDevToolsModes.get(guestWebContents.id)
  browserGuestDevToolsModes.set(guestWebContents.id, mode)
  const isModeTransition = previousMode !== undefined && previousMode !== mode
  if (isModeTransition) {
    browserGuestDevToolsTransitions.add(guestWebContents.id)
  }

  try {
    if (mode === 'undocked') {
      if (browserGuestDevToolsViews.has(guestWebContents.id)) {
        await closeDevToolsForTransition(guestWebContents)
        destroyBrowserGuestDevToolsView(guestWebContents.id)
      } else if (guestWebContents.isDevToolsOpened() && previousMode !== mode) {
        await closeDevToolsForTransition(guestWebContents)
      }
      guestWebContents.openDevTools({ mode: 'undocked', activate: true })
      return
    }

    if (!bounds) {
      throw new Error('Docked Browser DevTools require bounds.')
    }

    const normalizedBounds = normalizeBrowserDevToolsBounds(bounds)
    let entry = browserGuestDevToolsViews.get(guestWebContents.id)

    if (!entry || entry.ownerWindow.isDestroyed()) {
      if (guestWebContents.isDevToolsOpened()) {
        await closeDevToolsForTransition(guestWebContents)
      }
      destroyBrowserGuestDevToolsView(guestWebContents.id)

      const view = new WebContentsView({
        webPreferences: {
          sandbox: true,
        },
      })
      view.setBackgroundColor(ownerWindow.getBackgroundColor())
      view.setVisible(false)
      ownerWindow.contentView.addChildView(view)
      entry = { ownerWindow, ready: false, visible: false, view }
      browserGuestDevToolsViews.set(guestWebContents.id, entry)
      let readyScheduled = false
      let readyFallback: ReturnType<typeof setTimeout> | null = null
      let readyNotification: ReturnType<typeof setTimeout> | null = null
      const handleReady = () => {
        if (readyScheduled) {
          return
        }
        readyScheduled = true
        if (readyFallback) {
          clearTimeout(readyFallback)
          readyFallback = null
        }
        readyNotification = setTimeout(() => notifyBrowserGuestDevToolsReady(guestWebContents.id), 32)
      }
      readyFallback = setTimeout(handleReady, 1000)
      view.webContents.once('did-finish-load', handleReady)
      view.webContents.once('destroyed', () => {
        if (readyFallback) {
          clearTimeout(readyFallback)
        }
        if (readyNotification) {
          clearTimeout(readyNotification)
        }
        view.webContents.off('did-finish-load', handleReady)
      })
      guestWebContents.setDevToolsWebContents(view.webContents)
      guestWebContents.openDevTools({ mode: 'detach', activate: true })
    } else {
      if (!guestWebContents.isDevToolsOpened()) {
        guestWebContents.setDevToolsWebContents(entry.view.webContents)
        guestWebContents.openDevTools({ mode: 'detach', activate: true })
      }
    }

    entry.view.setBounds(normalizedBounds)
    if (entry.ready) {
      if (!entry.ownerWindow.isDestroyed()) {
        entry.ownerWindow.webContents.send('browser:devToolsReady', guestWebContents.id)
      }
    }
  } finally {
    if (isModeTransition) {
      setTimeout(() => browserGuestDevToolsTransitions.delete(guestWebContents.id), 100)
    }
  }
}

export function updateBrowserGuestDevToolsBounds(guestWebContentsId: number, bounds: Rectangle) {
  const entry = browserGuestDevToolsViews.get(guestWebContentsId)
  if (!entry || entry.ownerWindow.isDestroyed()) {
    return false
  }
  entry.view.setBounds(normalizeBrowserDevToolsBounds(bounds))
  return true
}

export function setBrowserGuestDevToolsVisible(guestWebContentsId: number, visible: boolean) {
  const entry = browserGuestDevToolsViews.get(guestWebContentsId)
  if (!entry || entry.ownerWindow.isDestroyed()) {
    return false
  }
  entry.visible = visible
  entry.view.setVisible(visible && entry.ready)
  return true
}

export function closeBrowserGuestDevTools(guestWebContents: WebContents) {
  browserGuestDevToolsModes.delete(guestWebContents.id)
  const entry = browserGuestDevToolsViews.get(guestWebContents.id)
  if (entry) {
    entry.visible = false
    entry.view.setVisible(false)
  }
  guestWebContents.closeDevTools()
}

function getInitialWindowBounds(savedState: TideCodeWindowState | null) {
  const { workArea } = screen.getPrimaryDisplay()
  const availableWidth = Math.max(1, workArea.width - WINDOW_SCREEN_MARGIN)
  const availableHeight = Math.max(1, workArea.height - WINDOW_SCREEN_MARGIN)
  const width = Math.min(
    Math.max(MIN_WINDOW_WIDTH, savedState?.width ?? DEFAULT_WINDOW_WIDTH),
    availableWidth,
  )
  const height = Math.min(
    Math.max(MIN_WINDOW_HEIGHT, savedState?.height ?? DEFAULT_WINDOW_HEIGHT),
    availableHeight,
  )

  const savedPositionIsVisible = savedState
    ? screen.getAllDisplays().some(({ workArea: displayWorkArea }) => {
        const overlapsHorizontally = savedState.x < displayWorkArea.x + displayWorkArea.width
          && savedState.x + width > displayWorkArea.x
        const overlapsVertically = savedState.y < displayWorkArea.y + displayWorkArea.height
          && savedState.y + height > displayWorkArea.y
        return overlapsHorizontally && overlapsVertically
      })
    : false

  return {
    x: savedPositionIsVisible && savedState
      ? savedState.x
      : workArea.x + Math.round((workArea.width - width) / 2),
    y: savedPositionIsVisible && savedState
      ? savedState.y
      : workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  }
}

export async function createApplicationWindow(input: {
  devServerUrl?: string
  initialLaunchRequest?: TideCodeLaunchRequest | null
  preloadDirectory: string
  rendererDist: string
}) {
  const savedWindowState = await readWindowState()
  const initialBounds = getInitialWindowBounds(savedWindowState)
  const initialSettings = await getStoredSettings().catch(() => null)
  const initialAppearance = initialSettings?.appearance ?? 'system'
  syncNativeThemeSource(initialAppearance)
  const appIconPath = getTideCodeAppIconPath()
  const windowOptions: BrowserWindowConstructorOptions = {
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(initialAppearance),
    height: initialBounds.height,
    minHeight: MIN_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    show: false,
    title: 'TideCode',
    width: initialBounds.width,
    x: initialBounds.x,
    y: initialBounds.y,
    webPreferences: {
      additionalArguments: [
        ...(initialSettings ? [serializeInitialSettingsArg(initialSettings)] : []),
        ...(input.initialLaunchRequest ? [serializeTideCodeLaunchRequest(input.initialLaunchRequest)] : []),
      ],
      preload: path.join(input.preloadDirectory, 'preload.mjs'),
      webviewTag: true,
    },
  }

  if (existsSync(appIconPath)) {
    windowOptions.icon = appIconPath
  }

  if (process.platform === 'win32' || process.platform === 'linux') {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.titleBarOverlay = getTitleBarOverlay(initialAppearance)
  }

  const win = new BrowserWindow(windowOptions)
  applyWindowTheme(win, initialAppearance)
  applyTideCodeAppIcon(win)

  win.setMenuBarVisibility(false)
  win.webContents.on('before-input-event', (event, inputEvent) => {
    const isPrimaryReloadShortcut =
      inputEvent.type === 'keyDown' &&
      (inputEvent.control || inputEvent.meta) &&
      !inputEvent.alt &&
      inputEvent.key.toLowerCase() === 'r'

    if (isPrimaryReloadShortcut) {
      event.preventDefault()
    }
  })
  win.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    browserFaviconCache.track(guestWebContents)
    const applyEmbeddedBrowserFocusBehavior = () => {
      void guestWebContents
        // Background setup must not grant user activation to the guest. Electron
        // may defer this execution until did-stop-loading.
        .executeJavaScript(EMBEDDED_BROWSER_POINTER_FOCUS_SCRIPT, false)
        .catch(() => undefined)
    }

    guestWebContents.on('dom-ready', applyEmbeddedBrowserFocusBehavior)
    guestWebContents.once('destroyed', () => {
      browserGuestDevToolsModes.delete(guestWebContents.id)
      browserGuestDevToolsTransitions.delete(guestWebContents.id)
      destroyBrowserGuestDevToolsView(guestWebContents.id)
    })
    guestWebContents.on('devtools-closed', () => {
      const entry = browserGuestDevToolsViews.get(guestWebContents.id)
      if (entry) {
        entry.visible = false
        entry.view.setVisible(false)
      }
      if (!browserGuestDevToolsTransitions.has(guestWebContents.id)) {
        destroyBrowserGuestDevToolsView(guestWebContents.id)
        if (!win.isDestroyed()) {
          win.webContents.send('browser:devToolsClosed', guestWebContents.id)
        }
      }
    })
    guestWebContents.on('before-input-event', (event, inputEvent) => {
      if (inputEvent.type !== 'keyDown') {
        return
      }

      const normalizedKey = inputEvent.key.toLowerCase()
      const isF12 = inputEvent.key === 'F12'
      const isWindowsOrLinuxDevTools =
        inputEvent.control &&
        inputEvent.shift &&
        !inputEvent.alt &&
        normalizedKey === 'i'
      const isMacDevTools =
        inputEvent.meta &&
        inputEvent.alt &&
        !inputEvent.control &&
        normalizedKey === 'i'

      if (!isF12 && !isWindowsOrLinuxDevTools && !isMacDevTools) {
        return
      }

      event.preventDefault()
      if (!win.isDestroyed()) {
        win.webContents.send('browser:devToolsShortcut', guestWebContents.id)
      }
    })
  })
  win.once('ready-to-show', () => {
    if (savedWindowState?.isFullScreen) {
      win.setFullScreen(true)
    } else if (savedWindowState?.isMaximized) {
      win.maximize()
    }
    win.show()
  })

  // Handle external links: open in system browser instead of Electron popup
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const activeWindow = win
    if (!activeWindow) {
      return
    }

    // Prevent in-app navigation to external URLs
    if (url !== activeWindow.webContents.getURL()) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (input.devServerUrl) {
    win.loadURL(input.devServerUrl)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(input.rendererDist, 'index.html'))
  }
  return win
}
