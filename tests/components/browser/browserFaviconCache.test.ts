import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { transform } from 'esbuild'

const source = await readFile(new URL('../../../electron/browser/faviconCache.ts', import.meta.url), 'utf8')
const compiled = await transform(source, { loader: 'ts', format: 'cjs', target: 'node22' })
const cacheModule = { exports: {} as typeof import('../../../electron/browser/faviconCache') }
vm.runInNewContext(compiled.code, {
  module: cacheModule,
  require: () => ({ net: { fetch: () => { throw new Error('Unexpected network request') } } }),
  Buffer,
  URL,
  AbortController,
  setTimeout,
  clearTimeout,
})
const { BrowserFaviconCache } = cacheModule.exports
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const iconDataUrl = `data:image/png;base64,${png.toString('base64')}`
const pngResponse = () => new Response(png, { headers: { 'content-type': 'image/png' } })

test('favicon requests share the same download and cached bytes', async () => {
  let requests = 0
  const cache = new BrowserFaviconCache(async (_url, options) => {
    requests += 1
    assert.equal(options?.credentials, 'omit')
    assert.equal(options?.redirect, 'manual')
    assert.equal(options?.bypassCustomProtocolHandlers, true)
    return pngResponse()
  })
  const first = cache.load('https://example.com/icon.png')
  assert.equal(cache.load('https://example.com/icon.png'), first)
  assert.equal(await first, iconDataUrl)
  assert.equal(await cache.load('https://example.com/icon.png'), iconDataUrl)
  assert.equal(requests, 1)
})

test('failed, oversized and non-image responses are cached as missing icons', async () => {
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(png, { headers: { 'content-length': String(128 * 1024 + 1) } }),
    new Response(Buffer.alloc(128 * 1024 + 1)),
    new Response('<html>not an icon</html>', { headers: { 'content-type': 'image/png' } }),
  ]) {
    let requests = 0
    const cache = new BrowserFaviconCache(async () => {
      requests += 1
      return response
    })
    assert.equal(await cache.load('https://example.com/icon'), '')
    assert.equal(await cache.load('https://example.com/icon'), '')
    assert.equal(requests, 1)
  }
  const offline = new BrowserFaviconCache(async () => { throw new Error('offline') })
  assert.equal(await offline.load('https://example.com/icon'), '')
})

test('favicon downloads reject unsafe URLs and redirects but accept bounded HTTP redirects', async () => {
  const requests: string[] = []
  const cache = new BrowserFaviconCache(async (url) => {
    requests.push(String(url))
    if (String(url).endsWith('/redirect')) {
      return new Response(null, { status: 302, headers: { location: '/icon.png' } })
    }
    if (String(url).endsWith('/unsafe')) {
      return new Response(null, { status: 302, headers: { location: 'file:///C:/private.png' } })
    }
    if (String(url).endsWith('/loop')) {
      return new Response(null, { status: 302, headers: { location: '/loop' } })
    }
    return pngResponse()
  })
  for (const url of ['file:///C:/private.png', 'javascript:alert(1)', 'https://user:secret@example.com/icon']) {
    assert.equal(await cache.load(url), '')
  }
  assert.equal(requests.length, 0)
  assert.equal(await cache.load('https://example.com/redirect'), iconDataUrl)
  assert.equal(requests.length, 2)
  assert.equal(await cache.load('https://example.com/unsafe'), '')
  assert.equal(requests.length, 3)
  assert.equal(await cache.load('https://example.com/loop'), '')
  assert.equal(requests.length, 7)
})

test('inline icons and ICO bytes are cached without third-party lookup services', async () => {
  const cache = new BrowserFaviconCache(async () => new Response(Buffer.from([0, 0, 1, 0, 1, 0]), {
    headers: { 'content-type': 'application/octet-stream' },
  }))
  assert.equal(await cache.load(iconDataUrl), iconDataUrl)
  assert.match(await cache.load('https://example.com/favicon.ico'), /^data:image\/x-icon;base64,/u)
  assert.equal(await cache.load('data:text/html;base64,PHNjcmlwdD4='), '')
  assert.equal(await cache.load(`data:image/png;base64,${'A'.repeat(200000)}`), '')
})

test('late favicon results cannot cross navigation, replacement or guest destruction', async () => {
  let finishDownload: (response: Response) => void = () => {}
  const cache = new BrowserFaviconCache(() => new Promise((resolve) => { finishDownload = resolve }))
  class Guest extends EventEmitter {
    id = 42
    url = 'https://first.example/'
    destroyed = false
    getURL() { return this.url }
    isDestroyed() { return this.destroyed }
  }
  const guest = new Guest()
  cache.track(guest as never)
  guest.emit('page-favicon-updated', {}, ['https://first.example/favicon.png'])
  const oldPage = cache.get(guest as never)
  guest.url = 'https://second.example/'
  guest.emit('did-navigate')
  finishDownload(pngResponse())
  assert.equal(await oldPage, null)
  assert.equal(cache.peek(guest as never), '')

  guest.emit('page-favicon-updated', {}, ['https://first.example/favicon.png'])
  const current = await cache.get(guest as never)
  assert.equal(current?.url, guest.url)
  assert.equal(current?.faviconDataUrl, iconDataUrl)
  guest.emit('page-favicon-updated', {}, [iconDataUrl])
  const pending = cache.get(guest as never)
  guest.emit('page-favicon-updated', {}, [])
  assert.equal(await pending, null)
  guest.emit('page-favicon-updated', {}, [iconDataUrl])
  guest.destroyed = true
  guest.emit('destroyed')
  assert.equal(await cache.get(guest as never), null)
})

test('the favicon IPC accepts only the main app frame and a webview owned by that window', async () => {
  const ipcSource = await readFile(new URL('../../../electron/ipc/registerCoreIpcHandlers.ts', import.meta.url), 'utf8')
  const start = ipcSource.indexOf('  const resolveBrowserGuest = ')
  const end = ipcSource.indexOf("  ipcMain.handle('browser:openDevTools'", start)
  assert.ok(start >= 0 && end > start)
  const compiledHandler = await transform(ipcSource.slice(start, end), { loader: 'ts', format: 'cjs' })
  let handler: (event: unknown, id: unknown) => Promise<unknown> = async () => null
  let reads = 0
  const frame = {}
  const sender = { id: 1, mainFrame: frame }
  const guest = { isDestroyed: () => false, getType: () => 'webview', hostWebContents: sender }
  const targets = new Map([
    [2, guest],
    [3, { ...guest, hostWebContents: { id: 99 } }],
    [4, { ...guest, getType: () => 'window' }],
    [5, { ...guest, isDestroyed: () => true }],
  ])
  vm.runInNewContext(compiledHandler.code, {
    webContents: { fromId: (id: number) => targets.get(id) },
    getWindow: () => ({ webContents: sender }),
    browserFaviconCache: { get: async () => { reads += 1; return iconDataUrl } },
    ipcMain: { handle: (channel: string, listener: typeof handler) => {
      assert.equal(channel, 'browser:getFavicon')
      handler = listener
    } },
  })
  const event = { sender, senderFrame: frame }
  for (const id of [0, -1, 1.5, '2', 3, 4, 5, 6, null]) {
    assert.equal(await handler(event, id), null)
  }
  assert.equal(await handler({ ...event, senderFrame: {} }, 2), null)
  assert.equal(await handler({ ...event, sender: { id: 99, mainFrame: frame } }, 2), null)
  assert.equal(reads, 0)
  assert.equal(await handler(event, 2), iconDataUrl)
  assert.equal(reads, 1)
})
