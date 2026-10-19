import {
  ipcMain,
  clipboard,
  nativeImage,
  shell,
  webContents,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron'
import { readFile } from 'node:fs/promises'
import { resolveBrowserScreenshot, saveBrowserScreenshot } from './screenshots'
import {
  createIncognitoTab,
  isNormalBrowserSession,
  ownsBrowserSession,
  releaseIncognitoTab,
  resolveBrowserSession,
} from './sessions'

export function registerBrowserPageActions(
  getWindow: () => BrowserWindow | null,
) {
  function requireOwner(event: IpcMainInvokeEvent) {
    const owner = getWindow()
    if (
      !owner ||
      owner.isDestroyed() ||
      event.sender !== owner.webContents ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error(
        'Browser actions are only available to the workspace window.',
      )
    }
  }
  function requireGuest(
    event: IpcMainInvokeEvent,
    input: { webContentsId: number },
  ) {
    requireOwner(event)
    const id = input?.webContentsId
    const guest = Number.isInteger(id) && id > 0 ? webContents.fromId(id) : null
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.getType() !== 'webview' ||
      guest.hostWebContents?.id !== event.sender.id ||
      !ownsBrowserSession(event.sender.id, guest.session)
    ) {
      throw new Error('The browser page is no longer available.')
    }
    return guest
  }
  ipcMain.handle('browser:createIncognitoTab', (event, input) => {
    requireOwner(event)
    return createIncognitoTab(event.sender, input?.projectKey)
  })
  ipcMain.handle('browser:releaseIncognitoTab', async (event, input) => {
    requireOwner(event)
    await releaseIncognitoTab(event.sender.id, input?.tabId)
  })
  ipcMain.handle('browser:captureScreenshot', async (event, input) => {
    const guest = requireGuest(event, input)
    if (!isNormalBrowserSession(guest.session)) {
      throw new Error('Screenshots are not saved in incognito tabs.')
    }
    const url = guest.getURL()
    const owner = getWindow()!
    const image = await guest.capturePage()
    if (image.isEmpty()) {
      throw new Error(
        'The webpage could not be captured. Try again once it is visible.',
      )
    }
    if (owner.isDestroyed()) {
      throw new Error('The workspace window is no longer available.')
    }
    return saveBrowserScreenshot(input.projectPath, url, image.toPNG())
  })
  ipcMain.handle('browser:screenshotAction', async (event, input) => {
    requireOwner(event)
    if (!['copyPath', 'reveal', 'copyImage'].includes(input?.action)) {
      throw new Error('Unknown screenshot action.')
    }
    const filePath = await resolveBrowserScreenshot(input)
    if (input.action === 'copyPath') {
      clipboard.writeText(filePath)
    } else if (input.action === 'reveal') {
      shell.showItemInFolder(filePath)
    } else {
      const image = nativeImage.createFromBuffer(await readFile(filePath))
      if (image.isEmpty()) {
        throw new Error('The saved screenshot could not be read.')
      }
      clipboard.writeImage(image)
    }
  })
  ipcMain.handle('browser:getZoom', (event, input) =>
    Math.round(requireGuest(event, input).getZoomFactor() * 100),
  )
  ipcMain.handle('browser:setZoom', (event, input) => {
    const guest = requireGuest(event, input)
    if (
      !Number.isFinite(input.percent) ||
      input.percent < 25 ||
      input.percent > 500
    ) {
      throw new Error('Browser zoom must be between 25% and 500%.')
    }
    guest.setZoomFactor(input.percent / 100)
    // Chromium can report the previous factor until the navigating frame commits.
    return input.percent
  })
  ipcMain.handle('browser:clearCookies', async (event, input) => {
    requireOwner(event)
    const browserSession = resolveBrowserSession(
      event.sender.id,
      input?.partition,
    )
    await browserSession.clearStorageData({ storages: ['cookies'] })
    await browserSession.cookies.flushStore()
  })
  ipcMain.handle('browser:clearCache', async (event, input) => {
    requireOwner(event)
    await resolveBrowserSession(event.sender.id, input?.partition).clearCache()
  })
}
