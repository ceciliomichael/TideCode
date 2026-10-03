import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBrowserHistory, recordBrowserVisit, updateBrowserFavicon } from '../../../src/components/browser/browserHistory'

test('website shortcuts normalize to origins without credentials, paths, queries, or fragments', () => {
  assert.deepEqual(recordBrowserVisit([], 'https://user:secret@www.example.com/docs?q=private#section'), [
    { label: 'example.com', url: 'https://www.example.com/' },
  ])
})

test('revisiting a website moves it to the front without duplicating its pages', () => {
  const sites = normalizeBrowserHistory(['https://first.example/', 'http://localhost:3000/docs'])
  const revisited = recordBrowserVisit(sites, 'http://localhost:3000/other')
  assert.deepEqual(revisited, [
    { label: 'localhost', url: 'http://localhost:3000/' },
    { label: 'first.example', url: 'https://first.example/' },
  ])
  assert.equal(recordBrowserVisit(revisited, 'http://localhost:3000/another'), revisited)
})

test('history ignores malformed data and unsafe or non-website schemes', () => {
  assert.deepEqual(normalizeBrowserHistory(null), [])
  assert.deepEqual(normalizeBrowserHistory({}), [])
  assert.deepEqual(normalizeBrowserHistory([
    null,
    42,
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///C:/secret.txt',
    'about:blank',
    'not a url',
    'https://example.com/',
    'https://example.com/docs',
  ]), [{ label: 'example.com', url: 'https://example.com/' }])
  const sites = normalizeBrowserHistory(['https://example.com/'])
  assert.equal(recordBrowserVisit(sites, 'javascript:alert(1)'), sites)
})

test('website shortcuts keep only the six most recent distinct sites', () => {
  const urls = Array.from({ length: 8 }, (_, index) => `https://site${index}.example/`)
  const sites = normalizeBrowserHistory(urls)
  assert.equal(sites.length, 6)
  const updated = recordBrowserVisit(sites, 'https://new.example/')
  assert.equal(updated.length, 6)
  assert.equal(updated[0].url, 'https://new.example/')
  assert.equal(updated[5].url, 'https://site4.example/')
})

const faviconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

test('saved history restores favicon bytes and preserves them on revisit', () => {
  const sites = normalizeBrowserHistory([
    { url: 'https://first.example/', faviconDataUrl },
    { url: 'https://second.example/private?q=secret', label: 'untrusted label', faviconDataUrl },
  ])
  assert.equal(sites[1].label, 'second.example')
  assert.equal(sites[1].url, 'https://second.example/')
  assert.equal(sites[1].faviconDataUrl, faviconDataUrl)
  assert.deepEqual(normalizeBrowserHistory(JSON.parse(JSON.stringify(sites))), sites)
  assert.equal(recordBrowserVisit(sites, 'https://second.example/another')[0].faviconDataUrl, faviconDataUrl)
})

test('favicon updates do not reorder visits or reintroduce evicted sites', () => {
  const sites = normalizeBrowserHistory(['https://first.example/', 'https://second.example/'])
  const updated = updateBrowserFavicon(sites, 'https://second.example/path', faviconDataUrl)
  assert.equal(updated[0].url, sites[0].url)
  assert.equal(updated[1].faviconDataUrl, faviconDataUrl)
  assert.equal(updateBrowserFavicon(updated, 'https://second.example/', faviconDataUrl), updated)
  assert.equal(updateBrowserFavicon(updated, 'https://evicted.example/', faviconDataUrl), updated)
  assert.equal(updateBrowserFavicon(updated, 'javascript:alert(1)', faviconDataUrl), updated)
})

test('saved icon data rejects external URLs, SVGs, oversized data and non-PNG bytes', () => {
  for (const invalidIcon of ['https://example.com/icon.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,SGVsbG8=', `${faviconDataUrl}${'A'.repeat(50000)}`]) {
    const sites = normalizeBrowserHistory([{ url: 'https://example.com/', faviconDataUrl: invalidIcon }])
    assert.equal(sites.length, 1)
    assert.equal(sites[0].faviconDataUrl, undefined)
    assert.equal(updateBrowserFavicon(sites, sites[0].url, invalidIcon), sites)
  }
})
