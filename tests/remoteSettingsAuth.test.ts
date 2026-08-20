import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import test from 'node:test'
import {
  DEFAULT_REMOTE_PORT,
  normalizeRemoteConfiguration,
  normalizeRemotePort,
} from '../electron/remote/configStore'
import {
  REMOTE_SESSION_COOKIE_NAME,
  REMOTE_SESSION_TTL_MS,
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

test('Remote web sessions use a persistent PWA-safe HttpOnly cookie', () => {
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
  assert.match(cookie, /SameSite=Lax/)
  assert.equal(cookie.includes('Path=/'), true)
  assert.equal(cookie.includes(sessionId), true)
  assert.match(cookie, new RegExp('Max-Age=' + Math.floor(REMOTE_SESSION_TTL_MS / 1000)))
  assert.match(cookie, /Expires=/)

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
  assert.match(headers.get('set-cookie') ?? '', /Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
})

test('Remote session cookie stays non-persistent when remember me is disabled', () => {
  const headers = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
  } as unknown as ServerResponse
  const store = new RemoteWebSessionStore()
  const request = {
    headers: { origin: 'https://remote.example.test' },
  } as unknown as IncomingMessage

  store.create(request, response, false)
  const cookie = headers.get('set-cookie') ?? ''
  assert.match(cookie, /SameSite=Lax/)
  assert.doesNotMatch(cookie, /Max-Age=/)
  assert.doesNotMatch(cookie, /Expires=/)
})

test('Remembered Remote sessions survive a desktop host restart without persisting the token', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-remote-session-test-'))
  const persistencePath = path.join(directory, 'sessions.json')
  const request = {
    headers: { origin: 'https://remote.example.test' },
  } as unknown as IncomingMessage
  const headers = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value) },
  } as unknown as ServerResponse

  try {
    const firstStore = new RemoteWebSessionStore({ persistencePath })
    const sessionId = firstStore.create(request, response, true)
    await firstStore.flush()
    const persisted = await fs.readFile(persistencePath, 'utf8')
    assert.doesNotMatch(persisted, new RegExp(sessionId))
    assert.match(headers.get('set-cookie') ?? '', new RegExp('Max-Age=' + Math.floor(REMOTE_SESSION_TTL_MS / 1000)))

    const secondStore = new RemoteWebSessionStore({ persistencePath })
    await secondStore.load()
    const authenticatedRequest = {
      headers: { cookie: (headers.get('set-cookie') ?? '').split(';', 1)[0], origin: 'https://remote.example.test' },
    } as unknown as IncomingMessage
    assert.equal(secondStore.validate(authenticatedRequest), sessionId)

    secondStore.delete(authenticatedRequest)
    await secondStore.flush()
    const thirdStore = new RemoteWebSessionStore({ persistencePath })
    await thirdStore.load()
    assert.equal(thirdStore.validate(authenticatedRequest), null)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
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
