import assert from 'node:assert/strict'
import test from 'node:test'
import { loadBrowserPlacement, saveBrowserPlacement } from '../../src/lib/browserPlacementStorage'

function withLocalStorage(run: () => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  })

  try {
    run()
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
}

test('browser placement loads the saved main-panel choice on startup', () => {
  withLocalStorage(() => {
    saveBrowserPlacement('main')

    assert.equal(loadBrowserPlacement(), 'main')
  })
})

test('browser placement defaults to side when no valid choice was saved', () => {
  withLocalStorage(() => {
    assert.equal(loadBrowserPlacement(), 'side')
    saveBrowserPlacement('side')
    assert.equal(loadBrowserPlacement(), 'side')
  })
})
