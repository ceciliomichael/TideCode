import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { transform } from 'esbuild'
import { normalizeRemoteBrowserUrl } from '../electron/remote/browserUrlPolicy'

const require = createRequire(import.meta.url)

test('remote browser session creation stays idle and navigation loads only the requested URL', async () => {
  const loadedUrls: string[] = []
  const trackedContents: unknown[] = []
  const faviconDataUrl = 'data:image/png;base64,iVBORw0KGgo='
  class BrowserWindowStub {
    private url = ''
    webContents = {
      debugger: {
        attach: () => {},
        on: () => {},
        sendCommand: async () => {},
      },
      setWindowOpenHandler: () => {},
      canGoBack: () => false,
      canGoForward: () => false,
      isLoading: () => false,
      getTitle: () => '',
      getURL: () => this.url,
      capturePage: async () => ({ toJPEG: () => Buffer.from('preview') }),
    }
    on() {}
    isDestroyed() { return false }
    async loadURL(url: string) {
      loadedUrls.push(url)
      this.url = url
    }
  }
  const source = await readFile(new URL('../electron/remote/browserService.ts', import.meta.url), 'utf8')
  const compiled = await transform(source, { loader: 'ts', format: 'cjs', target: 'node22' })
  const module = { exports: {} as { remoteBrowserService?: {
    capture: (projectKey: string, tabId: string) => Promise<{ url: string; faviconDataUrl: string }>
    navigate: (projectKey: string, tabId: string, url: string) => Promise<{ url: string; faviconDataUrl: string }>
  } } }
  vm.runInNewContext(compiled.code, {
    module,
    Buffer,
    require: (name: string) => {
      if (name === 'electron') {
        return { BrowserWindow: BrowserWindowStub }
      }
      if (name === './browserUrlPolicy') {
        return { normalizeRemoteBrowserUrl }
      }
      if (name === '../browser/faviconCache') {
        return { browserFaviconCache: {
          track: (contents: unknown) => trackedContents.push(contents),
          peek: () => faviconDataUrl,
        } }
      }
      return require(name)
    },
  })
  const service = module.exports.remoteBrowserService
  assert.ok(service)
  assert.equal((await service.capture('project', 'tab')).url, 'about:blank')
  assert.deepEqual(loadedUrls, [])
  const state = await service.navigate('project', 'tab', 'https://example.com/')
  assert.equal(state.url, 'https://example.com/')
  assert.equal(state.faviconDataUrl, faviconDataUrl)
  assert.equal(trackedContents.length, 1)
  assert.deepEqual(loadedUrls, ['https://example.com/'])
})
