import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRemoteBrowserUrl } from '../electron/remote/browserUrlPolicy'

test('remote browser URL policy allows only HTTP and HTTPS navigation', () => {
  assert.equal(normalizeRemoteBrowserUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(normalizeRemoteBrowserUrl('http://example.com'), 'http://example.com/')
  assert.throws(() => normalizeRemoteBrowserUrl('file:///C:/Windows/win.ini'), /only HTTP and HTTPS/u)
  assert.throws(() => normalizeRemoteBrowserUrl('data:text/html,secret'), /only HTTP and HTTPS/u)
  assert.throws(() => normalizeRemoteBrowserUrl('not a url'), /valid HTTP or HTTPS/u)
})
