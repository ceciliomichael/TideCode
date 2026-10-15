import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

interface HarnessOptions {
  hookAvailable?: boolean
  hookStartFails?: boolean
  scaleFactor?: number
}

async function createPopupHarness({
  hookAvailable = true,
  hookStartFails = false,
  scaleFactor = 1,
}: HarnessOptions = {}) {
  const source = await fs.readFile(new URL('../electron/window/trayPopup.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  const windows: PopupWindow[] = []
  const cursor = { x: 901, y: 971 }
  const trayBounds = { x: 900, y: 970, width: 24, height: 24 }
  const effects: string[] = []
  const hook = Object.assign(new EventEmitter(), {
    start() {
      if (hookStartFails) throw new Error('Native hook unavailable')
    },
    stop() { effects.push('stopHook') },
  })
  let openHandler: ((details: { url: string }) => { action: string }) | undefined

  class PopupWindow extends EventEmitter {
    opacity = 0
    ignoresMouse = true
    focused = false
    destroyed = false
    bounds = { x: 0, y: 0, width: 184, height: 69 }
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler(handler: typeof openHandler) {
        openHandler = handler
      },
    })

    constructor() {
      super()
      windows.push(this)
    }

    isDestroyed() { return this.destroyed }
    getOpacity() { return this.opacity }
    setOpacity(value: number) {
      this.opacity = value
      effects.push(`opacity:${value}`)
    }
    setIgnoreMouseEvents(value: boolean) {
      this.ignoresMouse = value
      effects.push(`ignoreMouse:${value}`)
    }
    setBounds(value: typeof this.bounds) { this.bounds = value }
    getBounds() { return this.bounds }
    setAlwaysOnTop() {}
    showInactive() {}
    moveTop() {}
    focus() { this.focused = true }
    async loadURL() {}
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }

  const exports: Partial<typeof import('../electron/window/trayPopup')> = {}
  runInNewContext(compiled.outputText, {
    exports,
    console: { error() {} },
    require(name: string) {
      if (name === 'electron') {
        return {
          BrowserWindow: PopupWindow,
          screen: {
            getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 970 } }),
            getCursorScreenPoint: () => cursor,
            screenToDipPoint: (point: { x: number; y: number }) => ({
              x: point.x / scaleFactor,
              y: point.y / scaleFactor,
            }),
          },
        }
      }
      if (name === 'uiohook-napi' && hookAvailable) return { uIOhook: hook }
      throw new Error(`Module unavailable: ${name}`)
    },
  })
  assert.ok(exports.createTrayPopupController)
  const controller = exports.createTrayPopupController({
    onQuit() { effects.push('quit') },
    onToggleWindow() { effects.push('toggleWindow') },
  })

  function press(x: number, y: number, button = 2) {
    cursor.x = x
    cursor.y = y
    hook.emit('mousedown', { x: x * scaleFactor, y: y * scaleFactor, button })
  }

  function chooseAction(action: 'toggle' | 'quit') {
    assert.ok(openHandler)
    return openHandler({ url: `tidecode-tray://${action}` })
  }

  return { controller, popup: windows[0], cursor, trayBounds, hook, effects, press, chooseAction }
}

for (const options of [{ hookAvailable: false }, { hookStartFails: true }]) {
  test(`outside focus loss dismisses when the hook fails: ${JSON.stringify(options)}`, async () => {
    const { controller, popup, cursor, trayBounds, hook } = await createPopupHarness(options)
    try {
      await controller.toggle(trayBounds)
      assert.equal(popup.opacity, 1)
      assert.equal(popup.focused, true, 'opening must take focus for outside blur dismissal')
      cursor.x = 200
      cursor.y = 200
      popup.emit('blur')
      assert.equal(popup.opacity, 0)
      assert.equal(popup.ignoresMouse, true)
      assert.equal(hook.listenerCount('mousedown'), 0)
    } finally {
      controller.destroy()
    }
  })
}

test('tray mouse-down closes before blur or the tray callback, which cannot reopen it', async () => {
  const { controller, popup, cursor, trayBounds, hook, effects, press } = await createPopupHarness()
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      cursor.x = trayBounds.x + 1
      cursor.y = trayBounds.y + 1
      await controller.toggle(trayBounds)
      effects.length = 0

      press(cursor.x, cursor.y)
      assert.equal(popup.opacity, 0, 'opacity is zero before any blur or tray callback')
      assert.equal(popup.ignoresMouse, true)
      assert.deepEqual(effects, ['opacity:0', 'ignoreMouse:true'])
      popup.emit('blur')
      assert.equal(popup.opacity, 0)

      await controller.toggle(trayBounds)
      assert.equal(popup.opacity, 0)
      assert.equal(popup.ignoresMouse, true)
      assert.equal(hook.listenerCount('mousedown'), 0)
      assert.deepEqual(effects, ['opacity:0', 'ignoreMouse:true', 'stopHook'])
    }
  } finally {
    controller.destroy()
  }
})

for (const options of [{}, { hookAvailable: false }, { hookStartFails: true }]) {
  test(`tray blur closes before its callback, even if blur precedes the hook: ${JSON.stringify(options)}`, async () => {
    const { controller, popup, trayBounds, hook, effects, press } = await createPopupHarness(options)
    try {
      await controller.toggle(trayBounds)
      effects.length = 0
      popup.emit('blur')
      assert.equal(popup.opacity, 0, 'blur over the tray does not wait for the tray callback')
      assert.deepEqual(effects.slice(0, 2), ['opacity:0', 'ignoreMouse:true'])

      press(trayBounds.x + 1, trayBounds.y + 1)
      await controller.toggle(trayBounds)
      assert.equal(popup.opacity, 0, 'the late hook and callback cannot reopen the popup')
      assert.equal(hook.listenerCount('mousedown'), 0)

      await controller.toggle(trayBounds)
      assert.equal(popup.opacity, 1, 'the next deliberate tray click can open normally')
    } finally {
      controller.destroy()
    }
  })
}

test('a new mouse press clears suppression if the closing tray gesture was cancelled', async () => {
  for (const nextPress of [{ x: 901, y: 971 }, { x: 200, y: 200 }]) {
    const { controller, popup, cursor, trayBounds, hook, press } = await createPopupHarness()
    try {
      await controller.toggle(trayBounds)
      press(trayBounds.x + 1, trayBounds.y + 1)
      assert.equal(popup.opacity, 0)

      // No callback arrives for the first press. A new physical press must not be
      // mistaken for that callback, even at exactly the same icon position.
      press(nextPress.x, nextPress.y)
      assert.equal(hook.listenerCount('mousedown'), 0)
      cursor.x = trayBounds.x + 1
      cursor.y = trayBounds.y + 1
      await controller.toggle(trayBounds)
      assert.equal(popup.opacity, 1)
    } finally {
      controller.destroy()
    }
  }
})

test('an empty tray rectangle does not turn the desktop into a suppressed tray click area', async () => {
  const { controller, popup, trayBounds, hook, press } = await createPopupHarness()
  try {
    await controller.toggle({ x: 0, y: 0, width: 0, height: 0 })
    press(200, 200)
    assert.equal(popup.opacity, 0)
    assert.equal(hook.listenerCount('mousedown'), 0)
    await controller.toggle(trayBounds)
    assert.equal(popup.opacity, 1, 'ordinary outside dismissal must not swallow the next tray callback')
  } finally {
    controller.destroy()
  }
})

test('the click area includes the actual click when the tray rectangle is empty or incomplete', async () => {
  for (const bounds of [
    { x: 0, y: 0, width: 0, height: 0 },
    { x: 90, y: 280, width: 10, height: 10 },
  ]) {
    const { controller, popup, cursor, press } = await createPopupHarness()
    try {
      cursor.x = 120
      cursor.y = 300
      await controller.toggle(bounds)
      press(125, 305)
      popup.emit('blur')
      assert.equal(popup.opacity, 0, 'the padded click area recognizes early tray dismissal')
      await controller.toggle(bounds)
      assert.equal(popup.opacity, 0, 'the tray callback closes instead of reopening')
    } finally {
      controller.destroy()
    }
  }
})

test('hook hit testing uses the same coordinates as Electron at scaled display settings', async () => {
  for (const scaleFactor of [1, 1.5, 2]) {
    const { controller, popup, trayBounds, press } = await createPopupHarness({ scaleFactor })
    try {
      await controller.toggle(trayBounds)
      press(popup.bounds.x + 20, popup.bounds.y + 20)
      assert.equal(popup.opacity, 1, 'a press within the popup stays within it after conversion')
      press(trayBounds.x + 1, trayBounds.y + 1)
      popup.emit('blur')
      assert.equal(popup.opacity, 0, 'a tray press dismisses before the tray callback')
      await controller.toggle(trayBounds)
      assert.equal(popup.opacity, 0)
    } finally {
      controller.destroy()
    }
  }
})

test('left, right, and middle outside presses close and clean up the native listener', async () => {
  for (const button of [1, 2, 3]) {
    const { controller, popup, trayBounds, hook, effects, press } = await createPopupHarness()
    try {
      await controller.toggle(trayBounds)
      assert.equal(popup.focused, true)
      effects.length = 0
      press(200, 200, button)
      assert.equal(popup.opacity, 0)
      assert.equal(popup.ignoresMouse, true)
      assert.equal(hook.listenerCount('mousedown'), 0)
      assert.deepEqual(effects, ['opacity:0', 'ignoreMouse:true', 'stopHook'])
    } finally {
      controller.destroy()
    }
  }
})

test('left-clicking the tray closes early and does not suppress a later right-click', async () => {
  const { controller, popup, trayBounds, press } = await createPopupHarness()
  try {
    await controller.toggle(trayBounds)
    press(trayBounds.x + 1, trayBounds.y + 1, 1)
    popup.emit('blur')
    assert.equal(popup.opacity, 0)
    controller.hide()
    assert.equal(popup.opacity, 0)
    await controller.toggle(trayBounds)
    assert.equal(popup.opacity, 1)
  } finally {
    controller.destroy()
  }
})

test('window opacity decides whether a tray click closes, matching the Git version', async () => {
  const { controller, popup, trayBounds, effects } = await createPopupHarness()
  try {
    await controller.toggle(trayBounds)
    popup.opacity = 0
    effects.length = 0
    await controller.toggle(trayBounds)
    assert.equal(popup.opacity, 1)
    assert.equal(popup.focused, true)
    effects.length = 0
    await controller.toggle(trayBounds)
    assert.equal(popup.opacity, 0)
    assert.deepEqual(effects, ['opacity:0', 'ignoreMouse:true', 'stopHook'])
    effects.length = 0
    controller.hide()
    assert.deepEqual(effects, ['opacity:0', 'ignoreMouse:true'])
  } finally {
    controller.destroy()
  }
})

test('Escape, popup right-click, and both menu actions dismiss before running actions', async () => {
  const { controller, popup, trayBounds, effects, chooseAction } = await createPopupHarness()
  try {
    for (const eventName of ['before-input-event', 'context-menu']) {
      await controller.toggle(trayBounds)
      let prevented = false
      popup.webContents.emit(eventName, { preventDefault() { prevented = true } }, {
        type: 'keyDown', key: 'Escape',
      })
      assert.equal(prevented, true)
      assert.equal(popup.opacity, 0)
    }
    for (const action of ['toggle', 'quit'] as const) {
      await controller.toggle(trayBounds)
      effects.length = 0
      assert.equal(chooseAction(action).action, 'deny')
      assert.deepEqual(effects, [
        'opacity:0', 'ignoreMouse:true', 'stopHook', action === 'toggle' ? 'toggleWindow' : 'quit',
      ])
    }
  } finally {
    controller.destroy()
  }
})

test('hide or destroy during opening prevents a delayed reopen or hook leak', async () => {
  for (const action of ['hide', 'destroy'] as const) {
    const { controller, popup, trayBounds, hook } = await createPopupHarness()
    try {
      const opening = controller.toggle(trayBounds)
      controller[action]()
      await opening
      assert.equal(popup.opacity, 0)
      assert.equal(hook.listenerCount('mousedown'), 0)
    } finally {
      controller.destroy()
    }
  }
})
