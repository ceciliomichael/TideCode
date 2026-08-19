import { ipcMain, type BrowserWindow } from 'electron'
import type { RemoteBridgeEvent, UpdateRemoteNetworkInput, UpdateRemoteWebAuthInput } from '../../src/remote/protocol'
import type { RemoteWorkspaceHost } from './host'

export function registerRemoteWorkspaceHostIpc(host: RemoteWorkspaceHost, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('remote:host:getStatus', () => host.getStatus())
  ipcMain.handle('remote:host:getConfiguration', () => host.getConfiguration())
  ipcMain.handle('remote:host:updateNetwork', (_event, input: UpdateRemoteNetworkInput) => host.updateNetwork(input))
  ipcMain.handle('remote:host:updateWebAuth', (_event, input: UpdateRemoteWebAuthInput) => host.updateWebAuth(input))
  ipcMain.handle('remote:host:clearWebCredentials', () => host.clearWebCredentials())
  ipcMain.on('remote:bridge:event', (event, payload: RemoteBridgeEvent) => {
    const window = getWindow()
    if (!window || event.sender.id !== window.webContents.id) return
    host.broadcastEvent(payload)
  })
  host.onStatus((status) => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send('remote:host:status', status)
  })
}
