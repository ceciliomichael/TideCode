import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WebSocket } from 'ws'
import { RemoteWorkspaceHost } from '../electron/remote/host'
import { clearRemotePassword } from '../electron/remote/authStore'
import { writeRemoteConfiguration } from '../electron/remote/configStore'

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to reserve a test port.'))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function requestText(port: number, pathname: string, options: { body?: string; cookie?: string; method?: string } = {}) {
  const http = await import('node:http')
  return new Promise<{ body: string; headers: import('node:http').IncomingHttpHeaders; statusCode: number }>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method ?? 'GET',
      headers: {
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(options.body) } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
        statusCode: response.statusCode ?? 0,
      }))
    })
    request.once('error', reject)
    if (options.body) request.write(options.body)
    request.end()
  })
}

async function connectWebSocket(port: number, cookie?: string) {
  return new Promise<{ ready: string; socket: WebSocket }>((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:' + port + '/remote/ws', {
      headers: {
        Origin: 'http://127.0.0.1:' + port,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    })
    let opened = false
    let ready: string | null = null
    const finish = () => {
      if (opened && ready !== null) resolve({ ready, socket })
    }
    socket.once('open', () => { opened = true; finish() })
    socket.once('message', (raw) => { ready = raw.toString(); finish() })
    socket.once('unexpected-response', (_request, response) => reject(new Error('unexpected-response:' + response.statusCode)))
    socket.once('error', reject)
  })
}

test('Remote host gates browser UI and WebSocket, then restarts on a new port', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-remote-state-'))
  const rendererRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-remote-renderer-'))
  process.env.TIDECODE_REMOTE_STATE_HOME = stateRoot
  const marker = 'REMOTE_RENDERER_MARKER'
  await fs.writeFile(path.join(rendererRoot, 'index.html'), '<!doctype html><title>Remote</title>' + marker, 'utf8')
  const firstPort = await reservePort()
  const secondPort = await reservePort()
  await clearRemotePassword()
  await writeRemoteConfiguration({ port: firstPort, webAuthEnabled: false, webUsername: '' })

  const host = new RemoteWorkspaceHost({ getWindow: () => null, rendererDist: rendererRoot })
  let socket: WebSocket | null = null
  try {
    const started = await host.start()
    assert.equal(started.boundPort, firstPort)
    assert.equal(started.lifecycleState, 'running')

    const openPage = await requestText(firstPort, '/')
    assert.equal(openPage.statusCode, 200)
    assert.match(openPage.body, new RegExp(marker))

    await host.updateWebAuth({ enabled: true, username: 'alice', password: 'correct horse battery staple' })

    const gatedPage = await requestText(firstPort, '/')
    assert.equal(gatedPage.statusCode, 200)
    assert.match(gatedPage.body, /TideCode Remote/)
    assert.doesNotMatch(gatedPage.body, new RegExp(marker))

    await assert.rejects(() => connectWebSocket(firstPort), /unexpected-response:401/)

    const wrongLogin = await requestText(firstPort, '/remote/auth/login', {
      body: JSON.stringify({ username: 'alice', password: 'wrong password' }),
      method: 'POST',
    })
    assert.equal(wrongLogin.statusCode, 401)

    const login = await requestText(firstPort, '/remote/auth/login', {
      body: JSON.stringify({ username: 'alice', password: 'correct horse battery staple' }),
      method: 'POST',
    })
    assert.equal(login.statusCode, 200)
    const setCookie = login.headers['set-cookie']?.[0]
    assert.ok(setCookie)
    const cookie = setCookie.split(';', 1)[0]

    const authenticatedPage = await requestText(firstPort, '/', { cookie })
    assert.equal(authenticatedPage.statusCode, 200)
    assert.match(authenticatedPage.body, new RegExp(marker))

    const connected = await connectWebSocket(firstPort, cookie)
    socket = connected.socket
    assert.match(connected.ready, /"kind":"ready"/)
    assert.equal(host.getStatus().connectedClientCount, 1)

    const restarted = await host.updateNetwork({ port: secondPort })
    assert.equal(restarted.boundPort, secondPort)
    assert.equal(restarted.configuredPort, secondPort)
    assert.equal(restarted.lifecycleState, 'running')
    assert.equal(restarted.connectedClientCount, 0)

    const newPortPage = await requestText(secondPort, '/')
    assert.equal(newPortPage.statusCode, 200)
    assert.match(newPortPage.body, /TideCode Remote/)
    assert.doesNotMatch(newPortPage.body, new RegExp(marker))

    await assert.rejects(() => requestText(firstPort, '/'), /ECONNREFUSED|socket hang up/)
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close()
    await host.stop().catch(() => undefined)
    await clearRemotePassword().catch(() => undefined)
    delete process.env.TIDECODE_REMOTE_STATE_HOME
    await fs.rm(stateRoot, { recursive: true, force: true })
    await fs.rm(rendererRoot, { recursive: true, force: true })
  }
})
