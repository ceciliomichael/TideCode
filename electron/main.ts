import { app, BrowserWindow, nativeTheme } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { StartChatStreamInput } from '../src/types/chat'
import { flushStoredSettingsUpdates, getStoredSettings } from './settings/store'
import { applyTideCodeAppIcon } from './window/branding'
import { applyWindowTheme } from './window/theme'
import { createApplicationWindow } from './window/createApplicationWindow'
import { closeAllTerminalSessions } from './terminal/service'
import { initializeProvidersState } from './providers/service'
import { onProvidersStateChanged } from './providers/events'
import { getMcpServerManager } from './mcp/serverManager'
import { disposeWorkspaceExplorerWatchers } from './workspace/explorerWatch'
import { disposeKanbanBoardWatchers } from './kanban/watch'
import { registerCoreIpcHandlers } from './ipc/registerCoreIpcHandlers'
import { registerChatGitTerminalIpcHandlers } from './ipc/registerChatGitTerminalIpcHandlers'
import { registerWorkspaceIpcHandlers } from './ipc/registerWorkspaceIpcHandlers'
import { registerMcpHandlers } from './ipc/registerMcpHandlers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

app.commandLine.appendSwitch(
  'disable-features',
  'OverlayScrollbar,OverlayScrollbars,FluentOverlayScrollbar,FluentScrollbars',
)

let win: BrowserWindow | null
const activeChatStreamProviders = new Map<string, StartChatStreamInput['providerId']>()
const mcpServerManager = getMcpServerManager()
onProvidersStateChanged(() => {
  if (!win || win.isDestroyed()) {
    return
  }

  win.webContents.send('providers:stateChanged')
})

// --- Instance / profile isolation ---
//
// You may run a dev instance (Vite dev server) *and* a packaged/built instance at the same time.
// On Windows, Chromium's disk cache is sensitive to concurrent access; if both instances share the
// same profile directories, you'll see:
//   "Unable to move the cache: Access is denied (0x5)" / "Gpu Cache Creation failed"
//
// We solve this by giving dev and packaged runs distinct userData/cache directories.
const isDevInstance = Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged
if (isDevInstance) {
  const appDataPath = app.getPath('appData')
  const devUserDataPath = path.join(appDataPath, `${app.getName()}-dev`)
  app.setPath('userData', devUserDataPath)
  // Keep cache within the dev profile too (avoids sharing GPUCache/Code Cache/etc.).
  app.setPath('cache', path.join(devUserDataPath, 'Cache'))
}

// Prevent multiple running instances *within the same flavor* (dev or packaged) from contending
// over the same Chromium profile/cache.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  // Ensure we don't continue bootstrapping anything in this process.
  process.exit(0)
}

app.on('second-instance', () => {
  // Someone tried to run a second instance, focus our window instead.
  if (win) {
    if (win.isMinimized()) {
      win.restore()
    }
    win.show()
    win.focus()
    return
  }

  // If we don't currently have a window (e.g. it was closed), recreate it.
  void createWindow()
})

let isQuitFlushInProgress = false

async function createWindow() {
  win = await createApplicationWindow({
    devServerUrl: VITE_DEV_SERVER_URL,
    preloadDirectory: __dirname,
    rendererDist: RENDERER_DIST,
  })
}

function registerApplicationIpcHandlers() {
  registerCoreIpcHandlers(() => win)
  registerChatGitTerminalIpcHandlers(activeChatStreamProviders)
  registerWorkspaceIpcHandlers()
}


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    disposeWorkspaceExplorerWatchers()
    disposeKanbanBoardWatchers()
    app.quit()
    win = null
  }
})

app.on('before-quit', (event) => {
  if (isQuitFlushInProgress) {
    return
  }

  event.preventDefault()
  isQuitFlushInProgress = true
  disposeWorkspaceExplorerWatchers()
  disposeKanbanBoardWatchers()
  void closeAllTerminalSessions().catch((error) => {
    console.error('Failed to close terminal sessions on quit', error)
  })
  void flushStoredSettingsUpdates()
    .catch((error) => {
      console.error('Failed to flush settings updates on quit', error)
    })
    .finally(() =>
      mcpServerManager
        .dispose()
        .catch((error) => {
          console.error('Failed to dispose MCP manager on quit', error)
        })
        .finally(() => {
          app.quit()
        }),
    )
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  registerApplicationIpcHandlers()
  registerMcpHandlers(mcpServerManager)
  mcpServerManager.onStateChange(({ state, workspacePath }) => {
    const currentWindow = win
    if (!currentWindow) {
      return
    }

    currentWindow.webContents.send('mcp:stateChanged', {
      state,
      workspacePath,
    })
  })

  void initializeProvidersState().catch((error) => {
    console.error('Failed to preload providers state', error)
  })

  void createWindow()

  nativeTheme.on('updated', () => {
    const currentWindow = win

    if (!currentWindow) {
      return
    }

    void getStoredSettings()
      .then((settings) => {
        if (settings.appearance === 'system') {
          applyWindowTheme(currentWindow, settings.appearance)
          applyTideCodeAppIcon(currentWindow)
        }
      })
      .catch((error) => {
        console.error('Failed to sync native theme', error)
      })
  })
})
