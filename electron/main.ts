import { app, BrowserWindow, nativeTheme } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { AppSettings, AppSettingsSurface, StartChatStreamInput } from '../src/types/chat'
import { flushStoredSettingsUpdates, getStoredSettings } from './settings/store'
import { applyTideCodeAppIcon } from './window/branding'
import { applyWindowTheme } from './window/theme'
import { createApplicationWindow } from './window/createApplicationWindow'
import { closeAllTerminalSessions, closeAllTerminalSessionsForWebContents } from './terminal/service'
import { initializeProvidersState } from './providers/service'
import { onProvidersStateChanged } from './providers/events'
import { getMcpServerManager } from './mcp/serverManager'
import { disposeWorkspaceExplorerWatchers } from './workspace/explorerWatch'
import { disposeProjectPathWatcher, startProjectPathWatcher } from './history/projectPathWatch'
import { disposeSourceControlWatchers } from './git/sourceControlWatch'
import { disposeKanbanBoardWatchers } from './kanban/watch'
import { registerCoreIpcHandlers } from './ipc/registerCoreIpcHandlers'
import { registerChatGitTerminalIpcHandlers } from './ipc/registerChatGitTerminalIpcHandlers'
import { registerWorkspaceIpcHandlers } from './ipc/registerWorkspaceIpcHandlers'
import { registerMcpHandlers } from './ipc/registerMcpHandlers'
import { registerUpdatesIpcHandlers } from './ipc/registerUpdatesIpcHandlers'
import { registerAppIpcHandlers } from './ipc/registerAppIpcHandlers'
import { isUpdateInstallInProgress } from './updates/autoUpdateService'
import { installLatestRequestedUpdate } from './updates/externalUpdateRequest'
import { hasExternalUpdateRequest } from '../src/lib/updateRequest'
import { parseTideCodeLaunchRequest, type TideCodeLaunchRequest } from '../src/lib/appLaunchRequest'
import { configureTideCodeRuntimeRoot } from './runtime/runtimeRoot'
import { RemoteWorkspaceHost } from './remote/host'
import { registerRemoteWorkspaceHostIpc } from './remote/ipc'
import { REMOTE_EVENT_CHANNELS } from '../src/remote/protocol'
import { hasSharedAppSettingsInput } from '../src/lib/appSettingsScopes'

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
configureTideCodeRuntimeRoot(process.env.APP_ROOT)
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
const configuredRemotePort = Number.parseInt(process.env.TIDECODE_REMOTE_PORT ?? '', 10)
const remoteWorkspaceHost = new RemoteWorkspaceHost({
  devServerUrl: VITE_DEV_SERVER_URL,
  getWindow: () => win,
  portOverride: Number.isInteger(configuredRemotePort) && configuredRemotePort > 0 && configuredRemotePort <= 65_535
    ? configuredRemotePort
    : undefined,
  rendererDist: RENDERER_DIST,
})
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

function focusApplicationWindow(currentWindow: BrowserWindow) {
  if (currentWindow.isMinimized()) {
    currentWindow.restore()
  }
  currentWindow.show()
  currentWindow.focus()
}

function deliverLaunchRequest(currentWindow: BrowserWindow, request: TideCodeLaunchRequest) {
  const sendRequest = () => {
    if (!currentWindow.isDestroyed()) {
      currentWindow.webContents.send('app:launchRequest', request)
    }
  }

  if (currentWindow.webContents.isLoading()) {
    currentWindow.webContents.once('did-finish-load', sendRequest)
    return
  }

  sendRequest()
}

app.on('second-instance', (_event, argv) => {
  if (hasExternalUpdateRequest(argv)) {
    void installLatestRequestedUpdate().catch((error) => {
      console.error('Failed to install the CLI-requested update.', error)
    })
    return
  }
  const launchRequest = parseTideCodeLaunchRequest(argv)
  // Someone tried to run a second instance, focus our window instead.
  if (win && !win.isDestroyed()) {
    focusApplicationWindow(win)
    if (launchRequest) {
      deliverLaunchRequest(win, launchRequest)
    }
    return
  }

  // If we don't currently have a window (e.g. it was closed), recreate it.
  void createWindow(launchRequest)
})

let isQuitFlushInProgress = false

async function createWindow(initialLaunchRequest: TideCodeLaunchRequest | null = null) {
  win = await createApplicationWindow({
    devServerUrl: VITE_DEV_SERVER_URL,
    initialLaunchRequest,
    preloadDirectory: __dirname,
    rendererDist: RENDERER_DIST,
  })

  const currentWindow = win
  currentWindow.webContents.on('did-start-loading', () => {
    closeAllTerminalSessionsForWebContents(currentWindow.webContents)
  })
  currentWindow.once('closed', () => {
    if (win === currentWindow) win = null
    void remoteWorkspaceHost.stop().catch((error) => {
      console.error('Failed to stop TideCode Remote Workspace host.', error)
    })
  })

  if (!currentWindow.isDestroyed() && currentWindow.webContents.isLoading()) {
    await new Promise<void>((resolve) => currentWindow.webContents.once('did-finish-load', () => resolve()))
  }
  await remoteWorkspaceHost.start().catch((error) => {
    console.error('Failed to start TideCode Remote Workspace host.', error)
  })
}

function registerApplicationIpcHandlers() {
  registerAppIpcHandlers()
  registerCoreIpcHandlers(() => win, async (
    settings: AppSettings,
    input: Partial<AppSettings>,
    surface: AppSettingsSurface,
  ) => {
    const hasSharedChanges = hasSharedAppSettingsInput(input)
    const currentWindow = win

    if (surface === 'desktop' || hasSharedChanges) {
      const desktopSettings = surface === 'desktop' ? settings : await getStoredSettings('desktop')
      if (currentWindow && !currentWindow.isDestroyed()) {
        currentWindow.webContents.send('settings:remoteChanged', desktopSettings)
      }
    }

    if (surface === 'web' || hasSharedChanges) {
      const webSettings = surface === 'web' ? settings : await getStoredSettings('web')
      remoteWorkspaceHost.broadcastEvent({
        channel: REMOTE_EVENT_CHANNELS.settingsChanged,
        payload: webSettings,
      })
    }
  })
  registerChatGitTerminalIpcHandlers(activeChatStreamProviders)
  registerWorkspaceIpcHandlers()
  registerUpdatesIpcHandlers(() => win)
}


// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    disposeWorkspaceExplorerWatchers()
    disposeProjectPathWatcher()
    disposeSourceControlWatchers()
    disposeKanbanBoardWatchers()
    app.quit()
    win = null
  }
})

app.on('before-quit', (event) => {
  if (isUpdateInstallInProgress()) {
    disposeWorkspaceExplorerWatchers()
    disposeProjectPathWatcher()
    disposeSourceControlWatchers()
    disposeKanbanBoardWatchers()
    return
  }

  if (isQuitFlushInProgress) {
    return
  }

  event.preventDefault()
  isQuitFlushInProgress = true
  disposeWorkspaceExplorerWatchers()
  disposeProjectPathWatcher()
  disposeSourceControlWatchers()
  disposeKanbanBoardWatchers()
  void Promise.all([
    closeAllTerminalSessions().catch((error) => {
      console.error('Failed to close terminal sessions on quit', error)
    }),
    remoteWorkspaceHost.stop().catch((error) => {
      console.error('Failed to stop TideCode Remote Workspace host on quit.', error)
    }),
    flushStoredSettingsUpdates().catch((error) => {
      console.error('Failed to flush settings updates on quit', error)
    }),
  ])
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

app.whenReady().then(async () => {
  registerApplicationIpcHandlers()
  registerMcpHandlers(mcpServerManager)
  registerRemoteWorkspaceHostIpc(remoteWorkspaceHost, () => win)
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

  await createWindow(parseTideCodeLaunchRequest(process.argv))
  void startProjectPathWatcher((event) => {
    const currentWindow = win
    if (!currentWindow || currentWindow.isDestroyed()) {
      return
    }

    currentWindow.webContents.send('history:projectFolderPruned', event)
  }).catch((error) => {
    console.error('Failed to start the Project path watcher.', error)
  })
  if (hasExternalUpdateRequest(process.argv)) {
    void installLatestRequestedUpdate().catch((error) => {
      console.error('Failed to install the CLI-requested update.', error)
    })
  }

  nativeTheme.on('updated', () => {
    const currentWindow = win

    if (!currentWindow || nativeTheme.themeSource !== 'system') {
      return
    }

    applyWindowTheme(currentWindow, 'system')
    applyTideCodeAppIcon(currentWindow)
  })
})
