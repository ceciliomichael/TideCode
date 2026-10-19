import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { transform } from 'esbuild'

// Run the production floating-window lifecycle with native window boundaries
// replaced, without importing unrelated application startup code.
const source = await readFile(
  new URL(
    '../../../electron/window/createApplicationWindow.ts',
    import.meta.url,
  ),
  'utf8',
)
const start = source.indexOf('const browserGuestFloatingDevTools')
const end = source.indexOf('function getInitialWindowBounds', start)
const compiled = await transform(source.slice(start, end), {
  loader: 'ts',
  format: 'cjs',
})

test('DevTools opens a floating child window, reuses it, and releases it on close', async () => {
  const windows: TestWindow[] = []
  class TestWindow extends EventEmitter {
    webContents = {}
    destroyed = false
    constructor(
      readonly options: {
        parent: unknown
        webPreferences: { sandbox: boolean }
      },
    ) {
      super()
      windows.push(this)
    }
    isDestroyed() {
      return this.destroyed
    }
    show() {}
    focus() {}
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  const module = {
    exports: {} as {
      openBrowserGuestDevTools: (
        guest: unknown,
        owner: unknown,
      ) => Promise<void>
      closeBrowserGuestDevTools: (guest: unknown) => void
    },
  }
  vm.runInThisContext(
    `(function(module, BrowserWindow) { ${compiled.code}\n })`,
  )(module, TestWindow)
  let opened = false
  const guest = {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    setDevToolsWebContents: () => {},
    openDevTools: (options: { mode: string }) => {
      assert.equal(options.mode, 'detach')
      opened = true
    },
    closeDevTools: () => {
      opened = false
    },
  }
  const owner = {}
  await module.exports.openBrowserGuestDevTools(guest, owner)
  await module.exports.openBrowserGuestDevTools(guest, owner)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].options.parent, owner)
  assert.equal(windows[0].options.webPreferences.sandbox, true)
  module.exports.closeBrowserGuestDevTools(guest)
  assert.equal(opened, false)
  assert.equal(windows[0].destroyed, true)
  await module.exports.openBrowserGuestDevTools(guest, owner)
  assert.equal(windows.length, 2)
  windows[1].destroy()
  assert.equal(
    opened,
    false,
    'closing the floating window closes the guest inspector',
  )
})
