import {
  BrowserWindow,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
} from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getStoredSettings } from '../settings/store'
import { serializeInitialSettingsArg } from '../settings/bootstrap'
import { serializeTideCodeLaunchRequest, type TideCodeLaunchRequest } from '../../src/lib/appLaunchRequest'
import { applyTideCodeAppIcon, getTideCodeAppIconPath } from './branding'
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
