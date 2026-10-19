import {
  BrowserWindow,
  screen,
  shell,
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
import { isNormalBrowserSession, trackPrivateBrowserGuest } from '../browser/sessions'
import { readWindowState, type TideCodeWindowState } from './windowState'
import {
  applyWindowTheme,
  getTitleBarOverlay,
  getWindowBackgroundColor,
  syncNativeThemeSource,
} from './theme'

const MIN_WINDOW_WIDTH = 900
const MIN_WINDOW_HEIGHT = 600
const DEFAULT_WINDOW_WIDTH = 1440
const DEFAULT_WINDOW_HEIGHT = 900
const WINDOW_SCREEN_MARGIN = 32
const EMBEDDED_BROWSER_TEXT_RESPONSE_COLORS_SCRIPT = `
(() => {
  // Chromium's native JSON/plain-text viewer can inherit the app's dark text
  // preference while keeping its default white page background.
  const contentType = document.contentType.toLowerCase()
  if (contentType !== 'text/plain' && !contentType.endsWith('/json') && !contentType.endsWith('+json')) return

  const pre = document.body?.querySelector(':scope > pre')
  if (!pre) return

  document.documentElement.style.colorScheme = 'light'
  document.body.style.color = '#202221'
  pre.style.setProperty('color', '#202221', 'important')
})()
`
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

const browserGuestFloatingDevTools = new Map<number, BrowserWindow>()

function destroyBrowserGuestFloatingDevTools(guestWebContentsId: number) {
  const floatingWindow = browserGuestFloatingDevTools.get(guestWebContentsId)
  browserGuestFloatingDevTools.delete(guestWebContentsId)
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.destroy()
  }
}

export async function openBrowserGuestDevTools(guestWebContents: WebContents, ownerWindow: BrowserWindow) {
  let floatingWindow = browserGuestFloatingDevTools.get(guestWebContents.id)
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    floatingWindow = new BrowserWindow({
      width: 960, height: 680, minWidth: 420, minHeight: 320,
      title: 'Browser DevTools', parent: ownerWindow,
      webPreferences: { sandbox: true },
    })
    const devToolsWindow = floatingWindow
    browserGuestFloatingDevTools.set(guestWebContents.id, devToolsWindow)
    devToolsWindow.on('closed', () => {
      if (browserGuestFloatingDevTools.get(guestWebContents.id) === devToolsWindow) {
        browserGuestFloatingDevTools.delete(guestWebContents.id)
        if (!guestWebContents.isDestroyed() && guestWebContents.isDevToolsOpened()) {
          guestWebContents.closeDevTools()
        }
      }
    })
    guestWebContents.setDevToolsWebContents(devToolsWindow.webContents)
    guestWebContents.openDevTools({ mode: 'detach', activate: true })
  }
  floatingWindow.show()
  floatingWindow.focus()
}

export function closeBrowserGuestDevTools(guestWebContents: WebContents) {
  guestWebContents.closeDevTools()
  destroyBrowserGuestFloatingDevTools(guestWebContents.id)
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
    trackPrivateBrowserGuest(guestWebContents)
    if (isNormalBrowserSession(guestWebContents.session)) {
      browserFaviconCache.track(guestWebContents)
    }
    const applyEmbeddedBrowserFocusBehavior = () => {
      void guestWebContents
        // Background setup must not grant user activation to the guest. Electron
        // may defer this execution until did-stop-loading.
        .executeJavaScript(EMBEDDED_BROWSER_POINTER_FOCUS_SCRIPT, false)
        .catch(() => undefined)
    }

    guestWebContents.on('dom-ready', applyEmbeddedBrowserFocusBehavior)
    guestWebContents.on('dom-ready', () => {
      void guestWebContents.executeJavaScript(EMBEDDED_BROWSER_TEXT_RESPONSE_COLORS_SCRIPT, false)
        .catch(() => undefined)
    })
    guestWebContents.once('destroyed', () => {
      destroyBrowserGuestFloatingDevTools(guestWebContents.id)
    })
    guestWebContents.on('devtools-closed', () => {
      destroyBrowserGuestFloatingDevTools(guestWebContents.id)
      if (!win.isDestroyed()) {
        win.webContents.send('browser:devToolsClosed', guestWebContents.id)
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
