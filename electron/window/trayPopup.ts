import { BrowserWindow, screen, type Rectangle } from 'electron'

const POPUP_WIDTH = 184
const POPUP_HEIGHT = 69
const POPUP_OVERLAP = 10

interface TrayPopupOptions {
  onQuit: () => void
  onToggleWindow: () => void
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
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
    ':root{--bg:#fff;--border:#d8d8d8;--hover:#f0f0f0;--text:#111;color-scheme:light dark}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#202020;--border:#3a3a3a;--hover:#303030;--text:#f5f5f5}}' +
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
  let outsideClickListener: (() => void) | null = null
  let outsideClickHookStarted = false
  let outsideClickHookToken = 0

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
    if (!popup || popup.isDestroyed()) {
      stopOutsideClickHook()
      return
    }
    popup.setIgnoreMouseEvents(true)
    popup.setOpacity(0)
    stopOutsideClickHook()
  }

  const startOutsideClickHook = () => {
    const activationToken = ++outsideClickHookToken
    void import('uiohook-napi')
      .then((hookModule) => {
        const currentPopup = popup
        if (
          activationToken !== outsideClickHookToken
          || !currentPopup
          || currentPopup.isDestroyed()
          || currentPopup.getOpacity() <= 0
        ) return

        const listener = () => {
          const visiblePopup = popup
          if (!visiblePopup || visiblePopup.isDestroyed() || visiblePopup.getOpacity() <= 0) return

          const point = screen.getCursorScreenPoint()
          const bounds = visiblePopup.getBounds()
          const isInside = point.x >= bounds.x
            && point.x < bounds.x + bounds.width
            && point.y >= bounds.y
            && point.y < bounds.y + bounds.height
          if (!isInside) hidePopup()
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
      })
      .catch((error) => {
        console.error('Failed to load the TideCode tray outside-click hook.', error)
      })
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
    nextPopup.on('closed', () => {
      if (popup === nextPopup) {
        popup = null
        popupReady = null
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
      const currentPopup = ensurePopup()
      if (currentPopup.getOpacity() > 0) {
        hidePopup()
        return
      }
      const position = getPopupPosition(trayBounds)
      currentPopup.setBounds({
        x: position.x,
        y: position.y,
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
      })

      const ready = popupReady
      if (ready) await ready
      if (popup !== currentPopup || currentPopup.isDestroyed()) return

      // Right-click can be delivered more than once by the Windows tray surface.
      // Presentation is intentionally idempotent, and uses opacity instead of show/hide so
      // Windows has no visible window animation to play.
      currentPopup.setIgnoreMouseEvents(false)
      currentPopup.setOpacity(1)
      currentPopup.moveTop()
      startOutsideClickHook()
    },
    hide() {
      hidePopup()
    },
    destroy() {
      stopOutsideClickHook()
      if (popup && !popup.isDestroyed()) popup.destroy()
      popup = null
      popupReady = null
    },
  }
}