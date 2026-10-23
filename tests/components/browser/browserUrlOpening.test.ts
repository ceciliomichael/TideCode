import assert from 'node:assert/strict'
import test from 'node:test'
import { openBrowserUrl } from '../../../electron/browser/openBrowserUrl'
import type { BrowserUrlRequest } from '../../../src/types/browser'

test('web links open as distinct requests in their originating workspace, including private popups', () => {
  const requests: BrowserUrlRequest[] = []
  const owner = {
    isDestroyed: () => false,
    send: (channel: string, request: BrowserUrlRequest) => {
      assert.equal(channel, 'browser:openUrl')
      requests.push(request)
    },
  }
  openBrowserUrl(owner, 'http://localhost:3000/test?q=hello#section')
  openBrowserUrl(owner, 'https://example.com', true)
  assert.deepEqual(requests.map(({ url, incognito }) => ({ url, incognito })), [
    { url: 'http://localhost:3000/test?q=hello#section', incognito: false },
    { url: 'https://example.com/', incognito: true },
  ])
  assert.notEqual(requests[0].id, requests[1].id)
})

test('URL opening rejects executable protocols, local files and closed windows without sending', () => {
  const owner = {
    isDestroyed: () => false,
    send: () => assert.fail('An invalid request must never reach the browser'),
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///C:/secret', 'tidecode://quit', '/relative', 'invalid']) {
    assert.throws(() => openBrowserUrl(owner, url))
  }
  assert.throws(() => openBrowserUrl({ ...owner, isDestroyed: () => true }, 'https://example.com'), /closed/u)
})
