import assert from 'node:assert/strict'
import type { IncomingMessage, ServerResponse } from 'node:http'
import test from 'node:test'
import {
  DEFAULT_REMOTE_PORT,
  normalizeRemoteConfiguration,
  normalizeRemotePort,
} from '../electron/remote/configStore'
import {
  REMOTE_SESSION_COOKIE_NAME,
  RemoteWebSessionStore,
  getLoginPageHtml,
} from '../electron/remote/webAuth'

test('Remote port normalization accepts user ports and rejects invalid values', () => {
  assert.equal(normalizeRemotePort(38472), 38472)
  assert.equal(normalizeRemotePort(1024), 1024)
  assert.equal(normalizeRemotePort(65535), 65535)
  assert.equal(normalizeRemotePort(80), DEFAULT_REMOTE_PORT)
  assert.equal(normalizeRemotePort(65536), DEFAULT_REMOTE_PORT)
  assert.equal(normalizeRemotePort(38472.5), DEFAULT_REMOTE_PORT)
  assert.equal(normalizeRemotePort('38472'), DEFAULT_REMOTE_PORT)
})

test('Remote configuration trims the username and falls back safely', () => {
  assert.deepEqual(normalizeRemoteConfiguration({
    port: 45678,
    webAuthEnabled: true,
    webUsername: '  alice  ',
  }), {
    port: 45678,
    webAuthEnabled: true,
    webUsername: 'alice',
  })
  assert.deepEqual(normalizeRemoteConfiguration({
    port: -1,
    webAuthEnabled: 'yes' as unknown as boolean,
    webUsername: 123 as unknown as string,
  }), {
    port: DEFAULT_REMOTE_PORT,
    webAuthEnabled: false,
    webUsername: '',
  })
})

test('Remote web sessions are carried only by the HttpOnly SameSite cookie', () => {
  const headers = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
  } as unknown as ServerResponse
  const store = new RemoteWebSessionStore()
  const request = {
    headers: { origin: 'https://remote.example.test' },
  } as unknown as IncomingMessage
  const sessionId = store.create(request, response)
  const cookie = headers.get('set-cookie')
  assert.ok(cookie)
  assert.match(cookie, new RegExp('^' + REMOTE_SESSION_COOKIE_NAME + '='))
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Strict/)
  assert.equal(cookie.includes('Path=/'), true)
  assert.equal(cookie.includes(sessionId), true)

  const authenticatedRequest = {
    headers: { cookie: cookie.split(';', 1)[0], origin: 'https://remote.example.test' },
  } as unknown as IncomingMessage
  assert.equal(store.validate(authenticatedRequest), sessionId)
  assert.equal(store.matchesOrigin(sessionId, authenticatedRequest), true)
  assert.equal(store.matchesOrigin(sessionId, {
    headers: { origin: 'https://other.example.test' },
  } as unknown as IncomingMessage), false)

  store.delete(authenticatedRequest, response)
assert.equal(store.validate(authenticatedRequest), null)
  assert.match(headers.get('set-cookie') ?? '', /Max-Age=0/)
})

test('Remote login page never embeds saved credentials', () => {
  const configured = getLoginPageHtml(true)
  const unconfigured = getLoginPageHtml(false)
  assert.match(configured, /TideCode Remote/)
  assert.match(configured, /type="password"/)
  assert.match(configured, /placeholder="Enter your Remote username"/)
  assert.match(configured, /placeholder="Enter your Remote password"/)
  assert.match(configured, /Settings &gt; Remote/)
  assert.match(unconfigured, /not been configured/)
  assert.doesNotMatch(configured, /value="[^"]+"/)
  assert.doesNotMatch(configured, /Authentication applies only to browser access/)
  assert.doesNotMatch(configured, /gradient\(/)
  assert.match(configured, /id="password-toggle"/)
  assert.match(configured, /aria-label="Show password"/)
  assert.match(configured, /class="eye-off"/)
})

test('Remote login page is constrained to the mobile viewport', () => {
  const html = getLoginPageHtml(true)
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1.0"/)
  assert.match(html, /min-height:100dvh/)
  assert.equal(html.includes('width:min(420px,100%)'), true)
  assert.equal(html.includes('*{box-sizing:border-box}'), true)
  assert.match(html, /input:focus,input:focus-visible\{outline:none;box-shadow:none;/)
})
