import * as electronModule from 'electron'
import type { App, BrowserWindow, Session, WebContents } from 'electron'

interface BrowserElectronRuntime {
  app: App
  BrowserWindow: typeof BrowserWindow
  webContents: { fromId(id: number): WebContents | undefined }
  session: { fromPartition(partition: string): Session }
}

/**
 * Electron is imported by both Node-only test/discovery processes and the
 * Electron main process. Resolve the actual main-process export explicitly.
 * Dynamic imports may expose only a default export in bundled CJS.
 */
export function requireBrowserElectronRuntime(): BrowserElectronRuntime {
  const imported = electronModule as unknown as {
    default?: unknown
    app?: unknown
    BrowserWindow?: unknown
    webContents?: unknown
    session?: unknown
  }
  const inner = imported.default && typeof imported.default === 'object'
    ? imported.default as Partial<BrowserElectronRuntime>
    : imported
  const candidate = imported.app && imported.webContents && imported.BrowserWindow
    ? imported : inner
  const runtime = candidate as Partial<BrowserElectronRuntime>
  if (typeof runtime.app?.isReady !== 'function'
    || typeof runtime.BrowserWindow !== 'function'
    || typeof runtime.webContents?.fromId !== 'function'
    || typeof runtime.session?.fromPartition !== 'function') {
    throw new Error('Browser automation requires the TideCode Electron desktop main process.')
  }
  return runtime as BrowserElectronRuntime
}
