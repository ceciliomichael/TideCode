import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Supply Vite's asset base while rendering the real components without a window.
const compiled = await build({
  stdin: {
    contents: `export { BrowserPanel } from '../../../src/components/browser/BrowserPanel'; export { BrowserNewTabPage } from '../../../src/components/browser/BrowserNewTabPage'; export { useBrowserHistory } from '../../../src/components/browser/useBrowserHistory'`,
    resolveDir: import.meta.dirname,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  define: { 'import.meta.env.BASE_URL': '"/"' },
})
const componentModule = { exports: {} as {
  BrowserPanel: typeof import('../../../src/components/browser/BrowserPanel').BrowserPanel
  BrowserNewTabPage: typeof import('../../../src/components/browser/BrowserNewTabPage').BrowserNewTabPage
  useBrowserHistory: typeof import('../../../src/components/browser/useBrowserHistory').useBrowserHistory
} }
vm.runInThisContext(`(function(module, require) { ${compiled.outputFiles[0].text}\n })`)(componentModule, createRequire(import.meta.url))
const { BrowserPanel, BrowserNewTabPage } = componentModule.exports

// Run the actual callbacks with a small hook harness; no DOM, Electron process,
// desktop focus, or test-only branches in production components are involved.
function createHookHarness() {
  const values: unknown[] = []
  let cursor = 0
  let effects: Array<() => void> = []
  const useState = (initial: unknown) => {
    const index = cursor++
    if (!(index in values)) {
      values[index] = typeof initial === 'function' ? initial() : initial
    }
    return [values[index], (update: unknown) => {
      values[index] = typeof update === 'function' ? update(values[index]) : update
    }]
  }
  const reactMock = {
    ...React,
    useState,
    useRef: (initial: unknown) => useState(() => ({ current: initial }))[0],
    useMemo: (calculate: () => unknown) => calculate(),
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void) => effects.push(effect),
  }
  const module = { exports: {} as typeof componentModule.exports }
  const require = createRequire(import.meta.url)
  vm.runInThisContext(`(function(module, require) { ${compiled.outputFiles[0].text}\n })`)(module, (name: string) => {
    if (name === 'react') {
      return reactMock
    }
    return require(name)
  })
  return {
    components: module.exports,
    render: <T,>(render: () => T) => {
      cursor = 0
      effects = []
      return render()
    },
    flushEffects: () => effects.forEach((effect) => effect()),
  }
}

test('the local new-tab page has a neutral search field and no external content', () => {
  const markup = renderToStaticMarkup(<BrowserNewTabPage onNavigate={() => {}} visitedSites={[]} />)
  assert.match(markup, /<h1[^>]*><span aria-label="TideCode"/u)
  assert.match(markup, /tidecode-word\.svg/u)
  assert.match(markup, /class="[^"]*h-24 w-\[264px\] max-w-full text-brand"/u)
  assert.match(markup, /grid-rows-\[1fr_auto_2fr\]/u)
  assert.match(markup, /row-start-2/u)
  assert.match(markup, /<form class="relative mt-2 rounded-2xl/u)
  assert.doesNotMatch(markup, /tidecode-wordmark\.svg|tidecode-mark\.svg|tidecode-icon-light|tidecode-icon-dark/u)
  assert.match(markup, /aria-label="Search"/u)
  assert.match(markup, /placeholder="Search"/u)
  assert.match(markup, /rounded-2xl/u)
  assert.match(markup, /h-11 w-full/u)
  assert.doesNotMatch(markup, /type="submit"|lucide-arrow-right/u)
  assert.doesNotMatch(markup, /Google|Searches use|enter a URL|focus-within:border-brand/u)
  assert.doesNotMatch(markup, /<webview|<iframe|https:\/\//u)
})

test('the new-tab page shows website shortcuts below the search field', () => {
  const markup = renderToStaticMarkup(
    <BrowserNewTabPage
      onNavigate={() => {}}
      visitedSites={[{ label: 'example.com', url: 'https://example.com/' }]}
    />,
  )
  assert.match(markup, /Recently visited/u)
  assert.match(markup, /example\.com/u)
  assert.match(markup, /title="https:\/\/example\.com\/"/u)
  assert.ok(markup.indexOf('Recently visited') > markup.indexOf('</form>'))
})

test('recent website icons render from cached bytes rather than external image URLs', () => {
  const faviconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  const markup = renderToStaticMarkup(
    <BrowserNewTabPage onNavigate={() => {}} visitedSites={[
      { label: 'cached.example', url: 'https://cached.example/', faviconDataUrl },
      { label: 'missing.example', url: 'https://missing.example/' },
    ]} />,
  )
  assert.ok(markup.includes(`src="${faviconDataUrl}"`))
  assert.match(markup, />M<\/span>/u)
  assert.doesNotMatch(markup, /src="https?:/u)
})

test('a failed cached icon switches back to the website initial', () => {
  const harness = createHookHarness()
  const page = harness.render(() => harness.components.BrowserNewTabPage({
    onNavigate: () => {},
    visitedSites: [{ label: 'cached.example', url: 'https://cached.example/', faviconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
  }))
  function findIcon(element: any): any {
    if (Array.isArray(element)) {
      return element.map(findIcon).find(Boolean)
    }
    if (!element || typeof element !== 'object') {
      return null
    }
    if (element.type?.name === 'VisitedSiteIcon') {
      return element
    }
    return findIcon(element.props?.children)
  }
  const icon = findIcon(page)
  assert.ok(icon)
  let rendered = harness.render(() => icon.type(icon.props))
  assert.equal(rendered.props.children.type, 'img')
  rendered.props.children.props.onError()
  rendered = harness.render(() => icon.type(icon.props))
  assert.equal(rendered.props.children, 'C')
})

test('Browser starts with an empty local new tab in Electron and web runtimes', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    for (const userAgent of ['Electron/43.7.5', 'Mozilla/5.0']) {
      Object.defineProperty(globalThis, 'navigator', {
        value: { userAgent },
        configurable: true,
      })
      const markup = renderToStaticMarkup(<BrowserPanel active={true} onClose={() => {}} projectKey="new-tab-test" />)
      assert.match(markup, /aria-label="New tab"/u)
      assert.match(markup, /aria-label="Search or enter address"[^>]*value=""/u)
      assert.match(markup, /aria-label="Reload" disabled=""/u)
      assert.doesNotMatch(markup, /<webview|<iframe|https:\/\/www\.google\.com/u)
      assert.doesNotMatch(markup, /aria-label="Open page DevTools"|Loading\.\.\./u)
    }
  } finally {
    if (navigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
  }
})

test('closing a non-last tab keeps Browser open; closing its last tab closes the panel', () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let panelClosures = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: { getItem: () => null },
    },
  })
  try {
    const harness = createHookHarness()
    const renderPanel = () => harness.render(() => harness.components.BrowserPanel({
      active: true,
      onClose: () => { panelClosures += 1 },
      projectKey: 'closing-test',
    }))
    const tabsBar = (panel: ReturnType<typeof renderPanel>) => panel.props.children[0].props
    let bar = tabsBar(renderPanel())
    bar.onCreateTab()
    bar = tabsBar(renderPanel())
    assert.equal(bar.tabs.length, 2)
    const firstTabId = bar.tabs[0].id
    bar.onCloseTab(firstTabId)
    bar = tabsBar(renderPanel())
    assert.equal(bar.tabs.length, 1)
    assert.equal(bar.activeTabId, bar.tabs[0].id)
    assert.equal(panelClosures, 0)
    bar.onCloseTab(bar.tabs[0].id)
    assert.equal(panelClosures, 1)
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

test('the history hook saves a decoded PNG and reopens it without loading the website or image again', async () => {
  const descriptors = new Map(['window', 'document', 'Image'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const storage = new Map<string, string>()
  const faviconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
  let imageLoads = 0
  class ImageStub {
    naturalWidth = 64
    naturalHeight = 64
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(value: string) {
      if (value) {
        assert.ok(value.startsWith('data:image/'))
        imageLoads += 1
        queueMicrotask(() => this.onload?.())
      }
    }
  }
  const globals = {
    window: { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    } },
    document: { createElement: (name: string) => {
      assert.equal(name, 'canvas')
      return { getContext: () => ({ drawImage: () => {} }), toDataURL: () => faviconDataUrl }
    } },
    Image: ImageStub,
  }
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, value })
  }
  try {
    const harness = createHookHarness()
    const renderHistory = () => harness.render(() => harness.components.useBrowserHistory('favicon-test'))
    let history = renderHistory()
    history.recordVisit('https://example.com/private')
    const downloadedIcon = 'data:image/x-icon;base64,AAABAAEA'
    history.cacheFavicon('https://example.com/private', downloadedIcon)
    history.cacheFavicon('https://example.com/private', downloadedIcon)
    await new Promise<void>((resolve) => setImmediate(resolve))
    history = renderHistory()
    harness.flushEffects()
    assert.equal(imageLoads, 1)
    assert.equal(history.visitedSites[0].faviconDataUrl, faviconDataUrl)
    assert.ok(storage.get('tidecode.browser.recentSites:favicon-test')?.includes(faviconDataUrl))
    const reopened = createHookHarness()
    const restored = reopened.render(() => reopened.components.useBrowserHistory('favicon-test'))
    assert.deepEqual(restored.visitedSites, history.visitedSites)
    assert.equal(imageLoads, 1)
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor)
      } else {
        Reflect.deleteProperty(globalThis, name)
      }
    }
  }
})
