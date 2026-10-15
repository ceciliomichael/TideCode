import { BrowserWindow, screen, type Point, type Rectangle } from 'electron'

const POPUP_WIDTH = 184
const POPUP_HEIGHT = 69
const POPUP_OVERLAP = 10
const TRAY_CLICK_SLOP = 10

interface TrayPopupOptions {
  onQuit: () => void
  onToggleWindow: () => void
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function containsPoint(bounds: Rectangle, x: number, y: number) {
  return x >= bounds.x
    && x < bounds.x + bounds.width
    && y >= bounds.y
    && y < bounds.y + bounds.height
}

function getTrayClickArea(trayBounds: Rectangle, click: Point): Rectangle {
  // Match TideStudio: Windows can report a zero-sized or incomplete overflow tray rect.
  if (trayBounds.width <= 0 || trayBounds.height <= 0) {
    return {
      x: Math.round(click.x) - TRAY_CLICK_SLOP,
      y: Math.round(click.y) - TRAY_CLICK_SLOP,
      width: TRAY_CLICK_SLOP * 2,
      height: TRAY_CLICK_SLOP * 2,
    }
  }
  const x = Math.min(trayBounds.x, Math.round(click.x) - TRAY_CLICK_SLOP)
  const y = Math.min(trayBounds.y, Math.round(click.y) - TRAY_CLICK_SLOP)
  const right = Math.max(trayBounds.x + trayBounds.width, Math.round(click.x) + TRAY_CLICK_SLOP)
  const bottom = Math.max(trayBounds.y + trayBounds.height, Math.round(click.y) + TRAY_CLICK_SLOP)
  return { x, y, width: right - x, height: bottom - y }
}

function getPopupPosition(trayBounds: Rectangle) {
  const display = screen.getDisplayMatching(trayBounds)
  const workArea = display.workArea
  const workRight = workArea.x + workArea.width
  const workBottom = workArea.y + workArea.height
  const trayRight = trayBounds.x + trayBounds.width
  const trayBottom = trayBounds.y + trayBounds.height

  let x = trayRight - POPUP_WIDTH
  let y = trayBounds.y - POPUP_HEIGHT + POPUP_OVERLAP

  if (trayBounds.y >= workBottom) {
    y = workBottom - POPUP_HEIGHT
  } else if (trayBottom <= workArea.y) {
    y = workArea.y
  } else if (trayBounds.x >= workRight) {
    x = workRight - POPUP_WIDTH
    y = trayBottom - POPUP_HEIGHT + POPUP_OVERLAP
  } else if (trayRight <= workArea.x) {
    x = workArea.x
    y = trayBottom - POPUP_HEIGHT + POPUP_OVERLAP
  }

  return {
    x: clamp(Math.round(x), workArea.x, workRight - POPUP_WIDTH),
    y: clamp(Math.round(y), workArea.y, workBottom - POPUP_HEIGHT),
  }
}

function createPopupMarkup() {
  return '<!doctype html>' +
    '<html><head><meta charset="utf-8">' +
    '<meta name="color-scheme" content="light dark">' +
    '<style>' +
    ':root{--bg:#fff;--border:#d4d9d5;--hover:#e9ecea;--text:#202221;color-scheme:light dark}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#242426;--border:#38383d;--hover:#2a2a2d;--text:#e9e9ea}}' +
    '*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--bg)}' +
    'body{font-family:"Segoe UI",system-ui,sans-serif;font-size:14px;user-select:none}' +
    '.menu{width:100%;height:100%;overflow:hidden;background:var(--bg)}' +
    'a{display:flex;align-items:center;width:100%;height:34px;padding:0 12px;color:var(--text);text-decoration:none;outline:none;cursor:default}' +
    'a+a{border-top:1px solid var(--border)}a:hover,a:focus-visible{background:var(--hover)}' +
    '</style></head><body><div class="menu">' +
    '<a href="tidecode-tray://toggle" target="_blank">Show/Hide Window</a>' +
    '<a href="tidecode-tray://quit" target="_blank">Quit TideCode</a>' +
    '</div></body></html>'
}

export function createTrayPopupController(options: TrayPopupOptions) {
  let popup: BrowserWindow | null = null
  let popupReady: Promise<void> | null = null
  let outsideClickHookModule: typeof import('uiohook-napi') | null = null
  let outsideClickListener: ((event: import('uiohook-napi').UiohookMouseEvent) => void) | null = null
  let outsideClickHookStarted = false
  let outsideClickHookToken = 0
  let popupVisibilityToken = 0
  let popupOpening = false
  let activeTrayBounds: Rectangle | null = null
  let pendingTrayToggle: 'mouse-down' | 'blur' | null = null

  const stopOutsideClickHook = () => {
    outsideClickHookToken += 1
    const hookModule = outsideClickHookModule
    const listener = outsideClickListener
    outsideClickHookModule = null
    outsideClickListener = null

    if (!hookModule || !outsideClickHookStarted) return
    outsideClickHookStarted = false
    if (listener) hookModule.uIOhook.off('mousedown', listener)
    hookModule.uIOhook.stop()
  }

  const hidePopup = () => {
    popupVisibilityToken += 1
    if (!popup || popup.isDestroyed()) {
      stopOutsideClickHook()
      return
    }
    popup.setOpacity(0)
    popup.setIgnoreMouseEvents(true)
    // Keep observing a pending tray gesture until its callback is consumed or a
    // new press proves it was cancelled. Do not suppress a later deliberate click.
    if (!pendingTrayToggle) stopOutsideClickHook()
  }

  const startOutsideClickHook = async () => {
    const activationToken = ++outsideClickHookToken
    let hookModule: typeof import('uiohook-napi')
    try {
      hookModule = await import('uiohook-napi')
    } catch (error) {
      console.error('Failed to load the TideCode tray outside-click hook.', error)
      return
    }

    const currentPopup = popup
    if (
      activationToken !== outsideClickHookToken
      || !currentPopup
      || currentPopup.isDestroyed()
    ) return

    const listener = (event: import('uiohook-napi').UiohookMouseEvent) => {
      const visiblePopup = popup
      if (!visiblePopup || visiblePopup.isDestroyed()) return

      // The hook reports physical pixels; Electron tray and window bounds use DIP.
      const point = screen.screenToDipPoint({ x: event.x, y: event.y })
      const insidePopup = containsPoint(visiblePopup.getBounds(), point.x, point.y)
      const insideTray = activeTrayBounds !== null
        && containsPoint(activeTrayBounds, point.x, point.y)

      if (visiblePopup.getOpacity() <= 0) {
        // Windows blur and the asynchronously delivered hook can arrive in either
        // order. This down still belongs to the gesture that blur already closed.
        if (pendingTrayToggle === 'blur' && insideTray && event.button === 2) {
          pendingTrayToggle = 'mouse-down'
          return
        }
        pendingTrayToggle = null
        stopOutsideClickHook()
        return
      }

      if (insidePopup) return
      pendingTrayToggle = insideTray && event.button === 2 ? 'mouse-down' : null
      hidePopup()
    }

    outsideClickHookModule = hookModule
    outsideClickListener = listener
    hookModule.uIOhook.on('mousedown', listener)
    try {
      hookModule.uIOhook.start()
      outsideClickHookStarted = true
    } catch (error) {
      hookModule.uIOhook.off('mousedown', listener)
      outsideClickHookModule = null
      outsideClickListener = null
      console.error('Failed to start the TideCode tray outside-click hook.', error)
    }
  }


  const loadPopupMarkup = () => {
    const currentPopup = popup
    if (!currentPopup || currentPopup.isDestroyed()) {
      popupReady = null
      return Promise.resolve()
    }

    popupReady = currentPopup
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(createPopupMarkup()))
      .then(() => undefined)
      .catch((error) => {
        console.error('Failed to load the TideCode tray popup.', error)
      })
    return popupReady
  }

  const ensurePopup = () => {
    if (popup && !popup.isDestroyed()) return popup

    const nextPopup = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      show: false,
      opacity: 0,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: false,
      backgroundColor: '#202020',
      hasShadow: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    nextPopup.webContents.setWindowOpenHandler(({ url }) => {
      if (url === 'tidecode-tray://toggle') {
        hidePopup()
        options.onToggleWindow()
      } else if (url === 'tidecode-tray://quit') {
        hidePopup()
        options.onQuit()
      }
      return { action: 'deny' }
    })
    nextPopup.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return
      event.preventDefault()
      hidePopup()
    })
    nextPopup.webContents.on('context-menu', (event) => {
      event.preventDefault()
      hidePopup()
    })
    nextPopup.on('blur', () => {
      if (nextPopup.isDestroyed() || nextPopup.getOpacity() <= 0) return
      const point = screen.getCursorScreenPoint()
      // Close now, including over the tray, rather than leaving a visible popup
      // behind the overflow panel while waiting for the tray's right-click event.
      pendingTrayToggle = activeTrayBounds && containsPoint(activeTrayBounds, point.x, point.y)
        ? 'blur'
        : null
      hidePopup()
    })
    nextPopup.on('closed', () => {
      if (popup === nextPopup) {
        pendingTrayToggle = null
        popup = null
        popupReady = null
        stopOutsideClickHook()
      }
    })

    popup = nextPopup
    nextPopup.setAlwaysOnTop(true, 'pop-up-menu')
    nextPopup.setIgnoreMouseEvents(true)
    // Load exactly once, then keep the native window alive at zero opacity. Theme changes
    // are handled by CSS, so there is no second navigation that can abort the first load.
    void loadPopupMarkup().then(() => {
      if (!nextPopup.isDestroyed()) nextPopup.showInactive()
    })
    return nextPopup
  }

  // Build and render the popup up front. The first native show happens only after the HTML
  // has loaded, while opacity is still zero. Normal tray interaction only changes opacity.
  ensurePopup()

  return {
    async toggle(trayBounds: Rectangle) {
      if (pendingTrayToggle) {
        pendingTrayToggle = null
        stopOutsideClickHook()
        return
      }
      const currentPopup = ensurePopup()
      if (currentPopup.getOpacity() > 0) {
        hidePopup()
        return
      }
      if (popupOpening) return

      activeTrayBounds = getTrayClickArea(trayBounds, screen.getCursorScreenPoint())
      popupOpening = true
      const visibilityToken = ++popupVisibilityToken
      const position = getPopupPosition(trayBounds)
      currentPopup.setBounds({
        x: position.x,
        y: position.y,
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
      })

      try {
        const ready = popupReady
        if (ready) await ready
        if (
          popup !== currentPopup
          || currentPopup.isDestroyed()
          || visibilityToken !== popupVisibilityToken
        ) return

        // Install dismissal before showing the popup so the first outside click is not lost
        // while the native hook is being loaded.
        await startOutsideClickHook()
        if (
          popup !== currentPopup
          || currentPopup.isDestroyed()
          || visibilityToken !== popupVisibilityToken
        ) return

        // Keep the original opacity-based presentation, but take focus so blur can
        // dismiss outside clicks even when the global mouse hook is unavailable.
        currentPopup.setIgnoreMouseEvents(false)
        currentPopup.setOpacity(1)
        currentPopup.moveTop()
        currentPopup.focus()
      } finally {
        popupOpening = false
      }
    },
    hide() {
      pendingTrayToggle = null
      hidePopup()
    },
    destroy() {
      popupVisibilityToken += 1
      pendingTrayToggle = null
      stopOutsideClickHook()
      if (popup && !popup.isDestroyed()) popup.destroy()
      popup = null
      popupReady = null
    },
  }
}
