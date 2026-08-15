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
import {
  applyWindowTheme,
  getTitleBarOverlay,
  getWindowBackgroundColor,
  syncNativeThemeSource,
} from './theme'

const MIN_WINDOW_WIDTH = 960
const MIN_WINDOW_HEIGHT = 680
function getInitialWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay()

  return {
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
  }
}

export async function createApplicationWindow(input: {
  devServerUrl?: string
  initialLaunchRequest?: TideCodeLaunchRequest | null
  preloadDirectory: string
  rendererDist: string
}) {
  const initialBounds = getInitialWindowBounds()
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
    if (!win) {
      return
    }

    if (!win.isMaximized()) {
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
