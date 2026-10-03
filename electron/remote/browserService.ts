import { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import type { RemoteBrowserFrameEvent, RemoteBrowserKeyInput, RemoteBrowserState } from '../../src/types/browser'
import { normalizeRemoteBrowserUrl } from './browserUrlPolicy'
import { browserFaviconCache } from '../browser/faviconCache'

const EMPTY_URL = 'about:blank'
const WIDTH = 1280
const HEIGHT = 800

interface SessionEntry {
  casting: boolean
  deviceScaleFactor: number
  height: number
  window: BrowserWindow
  width: number
}

type FrameListener = (frame: RemoteBrowserFrameEvent) => void

function partitionFor(projectKey: string) {
  const suffix = createHash('sha256').update(projectKey).digest('hex').slice(0, 16)
  return `persist:tidecode-remote-browser-${suffix}`
}

function sessionKey(projectKey: string, tabId: string) {
  return `${projectKey}::${tabId}`
}

class RemoteBrowserService {
  private readonly sessions = new Map<string, SessionEntry>()
  private frameListener: FrameListener | null = null

  setFrameListener(listener: FrameListener | null) {
    this.frameListener = listener
  }

  private getOrCreate(projectKey: string, tabId: string) {
    const key = sessionKey(projectKey, tabId)
    const existing = this.sessions.get(key)
    if (existing && !existing.window.isDestroyed()) return existing

    const window = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: HEIGHT,
      webPreferences: {
        backgroundThrottling: false,
        partition: partitionFor(projectKey),
        sandbox: true,
      },
    })
    const entry: SessionEntry = { casting: false, deviceScaleFactor: 1, height: HEIGHT, window, width: WIDTH }
    this.sessions.set(key, entry)
    browserFaviconCache.track(window.webContents)

    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        void window.loadURL(normalizeRemoteBrowserUrl(url))
      } catch {
        // Unsupported popup schemes stay denied and are never loaded.
      }
      return { action: 'deny' }
    })

    const debug = window.webContents.debugger
    debug.attach('1.3')
    debug.on('message', (_event, method, params) => {
      if (method !== 'Page.screencastFrame') return
      const frame = params as { data?: unknown; sessionId?: unknown }
      if (typeof frame.data !== 'string' || typeof frame.sessionId !== 'number') return

      void debug.sendCommand('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined)
      this.frameListener?.({
        projectKey,
        tabId,
        screenshotDataUrl: `data:image/png;base64,${frame.data}`,
        ...this.metadata(entry),
      })
    })

    window.on('closed', () => {
      this.sessions.delete(key)
    })

    return entry
  }

  private metadata(entry: SessionEntry) {
    const { webContents } = entry.window
    return {
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
      isLoading: webContents.isLoading(),
      title: webContents.getTitle(),
      url: webContents.getURL() || EMPTY_URL,
      faviconDataUrl: browserFaviconCache.peek(webContents),
    }
  }

  private async state(projectKey: string, tabId: string): Promise<RemoteBrowserState> {
    const entry = this.getOrCreate(projectKey, tabId)
    const image = await entry.window.webContents.capturePage()
    return {
      ...this.metadata(entry),
      screenshotDataUrl: `data:image/jpeg;base64,${image.toJPEG(72).toString('base64')}`,
    }
  }

  private async send(projectKey: string, tabId: string, method: string, params?: Record<string, unknown>) {
    const entry = this.getOrCreate(projectKey, tabId)
    return entry.window.webContents.debugger.sendCommand(method, params)
  }

  async capture(projectKey: string, tabId: string) {
    return this.state(projectKey, tabId)
  }

  async startScreencast(projectKey: string, tabId: string, width: number, height: number, deviceScaleFactor: number) {
    const entry = this.getOrCreate(projectKey, tabId)
    await this.resize(projectKey, tabId, width, height, deviceScaleFactor)
    if (!entry.casting) {
      await this.send(projectKey, tabId, 'Page.enable')
      await this.send(projectKey, tabId, 'Page.startScreencast', {
        format: 'png',
        maxWidth: Math.round(entry.width * entry.deviceScaleFactor),
        maxHeight: Math.round(entry.height * entry.deviceScaleFactor),
        everyNthFrame: 1,
      })
      entry.casting = true
    }
    return this.state(projectKey, tabId)
  }

  async stopScreencast(projectKey: string, tabId: string) {
    const entry = this.sessions.get(sessionKey(projectKey, tabId))
    if (!entry || entry.window.isDestroyed() || !entry.casting) return
    await entry.window.webContents.debugger.sendCommand('Page.stopScreencast').catch(() => undefined)
    entry.casting = false
  }

  async resize(projectKey: string, tabId: string, width: number, height: number, deviceScaleFactor: number) {
    const entry = this.getOrCreate(projectKey, tabId)
    const nextWidth = Math.max(320, Math.min(2560, Math.round(width)))
    const nextHeight = Math.max(240, Math.min(1800, Math.round(height)))
    const nextScale = Math.max(1, Math.min(3, deviceScaleFactor || 1))
    if (entry.width === nextWidth && entry.height === nextHeight && entry.deviceScaleFactor === nextScale) return
    entry.width = nextWidth
    entry.height = nextHeight
    entry.deviceScaleFactor = nextScale
    entry.window.setContentSize(nextWidth, nextHeight)
    await this.send(projectKey, tabId, 'Emulation.setDeviceMetricsOverride', {
      width: nextWidth,
      height: nextHeight,
      deviceScaleFactor: nextScale,
      mobile: false,
    })

    if (entry.casting) {
      await this.send(projectKey, tabId, 'Page.stopScreencast').catch(() => undefined)
      await this.send(projectKey, tabId, 'Page.startScreencast', {
        format: 'png',
        maxWidth: Math.round(nextWidth * nextScale),
        maxHeight: Math.round(nextHeight * nextScale),
        everyNthFrame: 1,
      })
    }
  }

  async navigate(projectKey: string, tabId: string, url: string) {
    const entry = this.getOrCreate(projectKey, tabId)
    await entry.window.loadURL(normalizeRemoteBrowserUrl(url))
    return this.state(projectKey, tabId)
  }

  async back(projectKey: string, tabId: string) {
    const entry = this.getOrCreate(projectKey, tabId)
    if (entry.window.webContents.canGoBack()) entry.window.webContents.goBack()
    return this.state(projectKey, tabId)
  }

  async forward(projectKey: string, tabId: string) {
    const entry = this.getOrCreate(projectKey, tabId)
    if (entry.window.webContents.canGoForward()) entry.window.webContents.goForward()
    return this.state(projectKey, tabId)
  }

  async reload(projectKey: string, tabId: string) {
    const entry = this.getOrCreate(projectKey, tabId)
    entry.window.webContents.reload()
    return this.state(projectKey, tabId)
  }

  async pointerDown(projectKey: string, tabId: string, x: number, y: number) {
    const entry = this.getOrCreate(projectKey, tabId)
    const safeX = Math.max(0, Math.min(entry.width - 1, Math.round(x)))
    const safeY = Math.max(0, Math.min(entry.height - 1, Math.round(y)))
    await this.send(projectKey, tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: safeX, y: safeY, button: 'left', clickCount: 1 })
  }

  async pointerUp(projectKey: string, tabId: string, x: number, y: number) {
    const entry = this.getOrCreate(projectKey, tabId)
    const safeX = Math.max(0, Math.min(entry.width - 1, Math.round(x)))
    const safeY = Math.max(0, Math.min(entry.height - 1, Math.round(y)))
    await this.send(projectKey, tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: safeX, y: safeY, button: 'left', clickCount: 1 })
  }

  async typeText(projectKey: string, tabId: string, text: string) {
    await this.send(projectKey, tabId, 'Input.insertText', { text })
  }

  async getSelectionText(projectKey: string, tabId: string) {
    const result = await this.send(projectKey, tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          const start = active.selectionStart ?? 0;
          const end = active.selectionEnd ?? start;
          return active.value.slice(start, end);
        }
        return window.getSelection()?.toString() ?? '';
      })()`,
      returnByValue: true,
    }) as { result?: { value?: unknown } }
    return typeof result.result?.value === 'string' ? result.result.value : ''
  }

  async key(projectKey: string, tabId: string, input: RemoteBrowserKeyInput) {
    const { altKey, code, ctrlKey, key, metaKey, shiftKey } = input
    const keyMap: Record<string, { code: string; keyCode: number }> = {
      Backspace: { code: 'Backspace', keyCode: 8 },
      Tab: { code: 'Tab', keyCode: 9 },
      Enter: { code: 'Enter', keyCode: 13 },
      Escape: { code: 'Escape', keyCode: 27 },
      ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
      ArrowUp: { code: 'ArrowUp', keyCode: 38 },
      ArrowRight: { code: 'ArrowRight', keyCode: 39 },
      ArrowDown: { code: 'ArrowDown', keyCode: 40 },
      Delete: { code: 'Delete', keyCode: 46 },
    }
    const mapped = keyMap[key]
    const letterKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
    const virtualKeyCode = mapped?.keyCode ?? letterKeyCode
    const modifiers = (altKey ? 1 : 0) | (ctrlKey ? 2 : 0) | (metaKey ? 4 : 0) | (shiftKey ? 8 : 0)
    const params = mapped
      ? { key, code: mapped.code, windowsVirtualKeyCode: mapped.keyCode, nativeVirtualKeyCode: mapped.keyCode, modifiers }
      : {
          key,
          code,
          windowsVirtualKeyCode: virtualKeyCode || undefined,
          nativeVirtualKeyCode: virtualKeyCode || undefined,
          modifiers,
        }
    if (key === 'Enter') {
      await this.send(projectKey, tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        ...params,
        text: '\r',
        unmodifiedText: '\r',
      })
      await this.send(projectKey, tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
      return
    }
    await this.send(projectKey, tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
    await this.send(projectKey, tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  }

  async movePointer(projectKey: string, tabId: string, x: number, y: number, buttons: number) {
    const entry = this.getOrCreate(projectKey, tabId)
    const safeX = Math.max(0, Math.min(entry.width - 1, Math.round(x)))
    const safeY = Math.max(0, Math.min(entry.height - 1, Math.round(y)))
    await this.send(projectKey, tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: safeX,
      y: safeY,
      button: buttons & 1 ? 'left' : 'none',
      buttons,
    })
    const result = await this.send(projectKey, tabId, 'Runtime.evaluate', {
      expression: `(() => { const el = document.elementFromPoint(${safeX}, ${safeY}); return el ? getComputedStyle(el).cursor : 'default'; })()`,
      returnByValue: true,
    }) as { result?: { value?: unknown } }
    return typeof result.result?.value === 'string' ? result.result.value : 'default'
  }

  async wheel(projectKey: string, tabId: string, x: number, y: number, deltaX: number, deltaY: number) {
    const entry = this.getOrCreate(projectKey, tabId)
    await this.send(projectKey, tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.max(0, Math.min(entry.width - 1, Math.round(x))),
      y: Math.max(0, Math.min(entry.height - 1, Math.round(y))),
      deltaX,
      deltaY,
    })
  }

  async close(projectKey: string, tabId: string) {
    const key = sessionKey(projectKey, tabId)
    const entry = this.sessions.get(key)
    if (!entry) return
    this.sessions.delete(key)
    if (!entry.window.isDestroyed()) entry.window.destroy()
  }
}

export const remoteBrowserService = new RemoteBrowserService()
