import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import { BROWSER_SESSION_PARTITION } from '../../../src/types/browser'

const compiled = await build({
  stdin: {
    contents: `export { registerBrowserPageActions } from '../../../electron/browser/pageActions'`,
    resolveDir: import.meta.dirname,
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
})

function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const calls: unknown[] = []
  const browserSession = {
    clearStorageData: async (input: unknown) => {
      calls.push(input)
    },
    clearCache: async () => {
      calls.push('cache')
    },
    cookies: {
      flushStore: async () => {
        calls.push('flush')
      },
    },
  }
  const owner = { id: 1, mainFrame: {} }
  let zoom = 1
  const guest = {
    getURL: () => 'https://www.google.com/search?q=test',
    capturePage: async () => ({
      isEmpty: () => false,
      toPNG: () => Buffer.from('png'),
    }),
    isDestroyed: () => false,
    getType: () => 'webview',
    hostWebContents: owner,
    session: browserSession,
    getZoomFactor: () => zoom,
    setZoomFactor: (value: number) => {
      zoom = value
    },
  }
  const module = {
    exports: {} as {
      registerBrowserPageActions: (getWindow: () => unknown) => void
    },
  }
  const require = createRequire(import.meta.url)
  vm.runInThisContext(
    `(function(module, require) { ${compiled.outputFiles[0].text}\n })`,
  )(module, (name: string) => {
    if (name === 'electron') {
      return {
        nativeImage: {
          createFromBuffer: (bytes: Buffer) => ({
            isEmpty: () => false,
            toPNG: () => bytes,
          }),
        },
        shell: {
          showItemInFolder: (filePath: string) =>
            calls.push({ reveal: filePath }),
        },
        clipboard: {
          writeText: (text: string) => calls.push({ text }),
          writeImage: (image: { toPNG: () => Buffer }) =>
            calls.push(image.toPNG()),
        },
        ipcMain: {
          handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
            handlers.set(channel, handler),
        },
        webContents: { fromId: (id: number) => (id === 2 ? guest : null) },
        session: {
          fromPartition: (partition: string) => {
            assert.equal(partition, BROWSER_SESSION_PARTITION)
            return browserSession
          },
        },
      }
    }
    return require(name)
  })
  module.exports.registerBrowserPageActions(() => ({
    webContents: owner,
    isDestroyed: () => false,
  }))
  const event = { sender: owner, senderFrame: owner.mainFrame }
  return {
    handlers,
    calls,
    event,
    guest,
  }
}

test('zoom applies only to an owned browser guest and validates the supported bounds', () => {
  const { handlers, event, guest } = fixture()
  const setZoom = handlers.get('browser:setZoom')!
  const getZoom = handlers.get('browser:getZoom')!
  assert.equal(setZoom(event, { webContentsId: 2, percent: 125 }), 125)
  assert.equal(getZoom(event, { webContentsId: 2 }), 125)
  for (const percent of [0, 501, NaN, Infinity]) {
    assert.throws(
      () => setZoom(event, { webContentsId: 2, percent }),
      /25% and 500%/,
    )
  }
  guest.hostWebContents = { id: 9, mainFrame: {} }
  assert.throws(
    () => setZoom(event, { webContentsId: 2, percent: 100 }),
    /no longer available/,
  )
})

test('screenshots save only owned guests and restrict clipboard and reveal actions to saved files', async (t) => {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), 'tidecode-screenshot-ipc-'),
  )
  t.after(() => rm(projectPath, { recursive: true, force: true }))
  const { handlers, calls, event, guest } = fixture()
  const capture = handlers.get('browser:captureScreenshot')!
  const screenshot = (await capture(event, {
    webContentsId: 2,
    projectPath,
  })) as { filePath: string; projectPath: string }
  assert.equal(calls.length, 0, 'saving does not change the clipboard')
  const action = handlers.get('browser:screenshotAction')!
  await action(event, { ...screenshot, action: 'copyPath' })
  await action(event, { ...screenshot, action: 'reveal' })
  await action(event, { ...screenshot, action: 'copyImage' })
  assert.deepEqual(calls, [
    { text: screenshot.filePath },
    { reveal: screenshot.filePath },
    Buffer.from('png'),
  ])
  await assert.rejects(
    async () =>
      action(event, {
        ...screenshot,
        filePath: path.join(projectPath, 'secret.png'),
        action: 'copyImage',
      }),
    /saved browser screenshot/,
  )
  await assert.rejects(
    async () =>
      action(
        { ...event, senderFrame: {} },
        { ...screenshot, action: 'copyPath' },
      ),
    /workspace window/,
  )
  guest.hostWebContents = { id: 9, mainFrame: {} }
  await assert.rejects(
    async () => capture(event, { webContentsId: 2, projectPath }),
    /no longer available/,
  )
  assert.equal(
    calls.length,
    3,
    'rejected actions cannot change the clipboard or open Explorer',
  )
})

test('cookie and cache clearing use the browser partition and reject other frames or windows', async () => {
  const { handlers, calls, event } = fixture()
  await handlers.get('browser:clearCookies')!(event)
  await handlers.get('browser:clearCache')!(event)
  assert.deepEqual(calls, [{ storages: ['cookies'] }, 'flush', 'cache'])
  assert.throws(
    () =>
      handlers.get('browser:getZoom')!(
        { ...event, senderFrame: {} },
        { webContentsId: 2 },
      ),
    /workspace window/,
  )
  await assert.rejects(async () => {
    await handlers.get('browser:clearCache')!({ ...event, sender: { id: 99 } })
  }, /workspace window/)
})
