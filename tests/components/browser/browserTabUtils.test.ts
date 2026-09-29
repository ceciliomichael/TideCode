import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BROWSER_URL,
  normalizeBrowserInput,
  normalizeEmbeddedBrowserUserAgent,
} from '../../../src/components/browser/browserTabUtils'

test('browser input keeps explicit HTTP and HTTPS URLs unchanged', () => {
  assert.equal(normalizeBrowserInput('http://localhost:3000/path'), 'http://localhost:3000/path')
  assert.equal(normalizeBrowserInput('https://example.com/path'), 'https://example.com/path')
})

test('browser input defaults local development hosts to HTTP', () => {
  assert.equal(normalizeBrowserInput('localhost:3000'), 'http://localhost:3000')
  assert.equal(normalizeBrowserInput('127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app')
  assert.equal(normalizeBrowserInput('127.12.34.56:8080'), 'http://127.12.34.56:8080')
  assert.equal(normalizeBrowserInput('0.0.0.0:4173'), 'http://0.0.0.0:4173')
  assert.equal(normalizeBrowserInput('[::1]:3000'), 'http://[::1]:3000')
})

test('browser input keeps HTTPS as the default for ordinary web hosts', () => {
  assert.equal(normalizeBrowserInput('example.com'), 'https://example.com')
  assert.equal(normalizeBrowserInput('app.example.com/docs'), 'https://app.example.com/docs')
})

test('browser input treats host-and-port values as navigable hosts', () => {
  assert.equal(normalizeBrowserInput('devbox:3000'), 'https://devbox:3000')
})

test('browser input searches normal text and uses the default home for empty input', () => {
  assert.equal(
    normalizeBrowserInput('nextjs dev overlay'),
    'https://www.google.com/search?q=nextjs%20dev%20overlay',
  )
  assert.equal(normalizeBrowserInput('   '), DEFAULT_BROWSER_URL)
})

test('embedded browser user agent removes Electron identity while preserving Chromium identity', () => {
  assert.equal(
    normalizeEmbeddedBrowserUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36 Electron/43.2.0',
    ),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36',
  )
})
