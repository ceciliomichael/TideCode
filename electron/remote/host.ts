import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import type { BrowserWindow } from 'electron'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import {
  REMOTE_EVENT_CHANNELS,
  REMOTE_PROTOCOL_VERSION,
  isRemoteRpcRequest,
  type RemoteBridgeEvent,
  type RemoteHostAddress,
  type RemoteHostConfiguration,
  type RemoteHostStatus,
  type RemoteRpcResponse,
  type UpdateRemoteNetworkInput,
  type UpdateRemoteWebAuthInput,
} from '../../src/remote/protocol'
import { clearRemotePassword, hasRemoteCredential, setRemotePassword, verifyRemotePassword } from './authStore'
import {
  DEFAULT_REMOTE_PORT,
  MAX_REMOTE_PORT,
  MIN_REMOTE_PORT,
  readRemoteConfiguration,
  writeRemoteConfiguration,
} from './configStore'
import { getLoginPageHtml, readAuthJsonBody, writeJson } from './webAuth'
import { RemoteWebSessionStore } from './sessionStore'
import { getRemoteStateRoot } from './statePath'

const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024 * 1024
const LOGIN_FAILURE_WINDOW_MS = 60_000
const MAX_LOGIN_FAILURES = 5

interface RemoteWorkspaceHostOptions {
  devServerUrl?: string
  getWindow: () => BrowserWindow | null
  portOverride?: number
  rendererDist: string
}

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  return ({
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

function classifyInterface(name: string, address: string): { kind: RemoteHostAddress['kind']; priority: number } {
  const normalizedName = name.toLowerCase()
  if (address.startsWith('169.254.')) return { kind: 'virtual', priority: 100 }
  if (/tailscale|zerotier/.test(normalizedName)) return { kind: 'overlay', priority: 20 }
  if (/wsl|vethernet|hyper-v|docker|vmware|virtualbox|loopback/.test(normalizedName)) return { kind: 'virtual', priority: 50 }
  if (/wi-?fi|wireless|wlan|ethernet|en\d|eth\d/.test(normalizedName)) return { kind: 'lan', priority: 0 }
  return { kind: 'other', priority: 10 }
}

export function getRemoteHostAddresses(port: number): RemoteHostAddress[] {
  const candidates: Array<RemoteHostAddress & { priority: number }> = []
  const seen = new Set<string>()
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || seen.has(entry.address)) continue
      seen.add(entry.address)
      const classification = classifyInterface(interfaceName, entry.address)
      candidates.push({
        address: entry.address,
        interfaceName,
        kind: classification.kind,
        priority: classification.priority,
        url: `http://${entry.address}:${port}`,
      })
    }
  }
  candidates.sort((left, right) => left.priority - right.priority || left.interfaceName.localeCompare(right.interfaceName) || left.address.localeCompare(right.address))
  if (candidates.length === 0) {
    return [{ address: '127.0.0.1', interfaceName: 'Loopback', kind: 'other', url: `http://127.0.0.1:${port}` }]
  }
  return candidates.map(({ address, interfaceName, kind, url }) => ({ address, interfaceName, kind, url }))
}

function writeUpgradeError(socket: Duplex, statusCode: number, statusText: string) {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function getFirstHeaderValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.split(',', 1)[0]?.trim() || null
}

function getForwardedHost(request: IncomingMessage) {
  const forwardedHost = getFirstHeaderValue(request.headers['x-forwarded-host'])
  if (forwardedHost) return forwardedHost

  const forwarded = getFirstHeaderValue(request.headers.forwarded)
  if (!forwarded) return null
  for (const part of forwarded.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0 || part.slice(0, separator).trim().toLowerCase() !== 'host') continue
    return part.slice(separator + 1).trim().replace(/^"|"$/g, '') || null
  }
  return null
}

function isLoopbackPeer(request: IncomingMessage) {
  const address = request.socket.remoteAddress?.toLowerCase() ?? ''
  return address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.')
}

function isSameOriginRequest(request: IncomingMessage) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (!origin || !host) return false
  try {
    const originHost = new URL(origin).host.toLowerCase()
    if (originHost === host.toLowerCase()) return true
    if (!isLoopbackPeer(request)) return false
    return originHost === getForwardedHost(request)?.toLowerCase()
  } catch {
    return false
  }
}

export class RemoteWorkspaceHost {
  private readonly clients = new Set<WebSocket>()
  private readonly clientSessionTimers = new Map<WebSocket, ReturnType<typeof setTimeout>>()
  private readonly loginFailures = new Map<string, { count: number; firstFailureAt: number }>()
  private readonly sessions: RemoteWebSessionStore
  private readonly statusListeners = new Set<(status: RemoteHostStatus) => void>()
  private readonly options: RemoteWorkspaceHostOptions
  private configuration: RemoteHostConfiguration = { port: DEFAULT_REMOTE_PORT, webAuthEnabled: false, webUsername: '' }
  private credentialsConfigured = false
  private lifecycleQueue: Promise<void> = Promise.resolve()
  private server: ReturnType<typeof createServer> | null = null
  private webSocketServer: WebSocketServer | null = null
  private status: RemoteHostStatus = {
    addresses: [],
    boundPort: null,
    configuredPort: DEFAULT_REMOTE_PORT,
    connectedClientCount: 0,
    enabled: false,
    error: null,
    lifecycleState: 'stopped',
    port: null,
    portOverrideActive: false,
    primaryUrl: null,
    remoteUrl: null,
    urls: [],
    webAuthEnabled: false,
    webCredentialsConfigured: false,
  }

  constructor(options: RemoteWorkspaceHostOptions) {
    this.options = options
    this.sessions = new RemoteWebSessionStore({
      persistencePath: path.join(getRemoteStateRoot(), 'remote-sessions.json'),
    })
  }

  getStatus() {
    return { ...this.status, addresses: this.status.addresses.map((entry) => ({ ...entry })), urls: [...this.status.urls] }
  }

  async getConfiguration() {
    if (!this.server) this.configuration = await readRemoteConfiguration()
    return { ...this.configuration }
  }

  onStatus(listener: (status: RemoteHostStatus) => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private setStatus(next: Partial<RemoteHostStatus>) {
    this.status = { ...this.status, ...next }
    const snapshot = this.getStatus()
    for (const listener of this.statusListeners) listener(snapshot)
  }

  async start() {
    if (this.server) return this.getStatus()
    this.configuration = await readRemoteConfiguration()
    this.credentialsConfigured = await hasRemoteCredential()
    return this.startWithConfiguration(this.configuration, 'starting')
  }

  private getEffectivePort(configuration: RemoteHostConfiguration) {
    return this.options.portOverride ?? configuration.port
  }

  private async startWithConfiguration(configuration: RemoteHostConfiguration, lifecycleState: 'starting' | 'restarting') {
    if (this.server) return this.getStatus()
    await this.sessions.load()
    this.configuration = { ...configuration }
    const preferredPort = this.getEffectivePort(configuration)
    this.setStatus({
      configuredPort: configuration.port,
      error: null,
      lifecycleState,
      portOverrideActive: this.options.portOverride !== undefined,
      webAuthEnabled: configuration.webAuthEnabled,
      webCredentialsConfigured: this.credentialsConfigured,
    })
    const server = createServer((request, response) => {
      void this.handleHttpRequest(request, response).catch((error) => {
        console.error('TideCode remote HTTP request failed.', error)
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('TideCode remote host error.')
      })
    })
    const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES })
    this.server = server
    this.webSocketServer = webSocketServer
    server.on('upgrade', (request, socket, head) => { void this.handleUpgrade(request, socket, head) })

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error) }
        const onListening = () => { server.off('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(preferredPort, '0.0.0.0')
      })
    } catch (error) {
      this.server = null
      this.webSocketServer = null
      this.setStatus({ enabled: false, error: error instanceof Error ? error.message : String(error), lifecycleState: 'error' })
      throw error
    }

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : preferredPort
    const addresses = getRemoteHostAddresses(port)
    const urls = addresses.map((entry) => entry.url)
    this.setStatus({
      addresses,
      boundPort: port,
      configuredPort: configuration.port,
      enabled: true,
      error: null,
      lifecycleState: 'running',
      port,
      portOverrideActive: this.options.portOverride !== undefined,
      primaryUrl: urls[0] ?? null,
      remoteUrl: urls[0] ?? null,
      urls,
      webAuthEnabled: configuration.webAuthEnabled,
      webCredentialsConfigured: this.credentialsConfigured,
    })
    return this.getStatus()
  }

  private async stopServer(reason: string) {
    const server = this.server
    this.server = null
    this.webSocketServer = null
    for (const timer of this.clientSessionTimers.values()) clearTimeout(timer)
    this.clientSessionTimers.clear()
    for (const socket of this.clients) socket.close(1001, reason)
    this.clients.clear()
    this.sessions.clear(false)
    this.setStatus({ connectedClientCount: 0 })
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  async stop() {
    await this.stopServer('TideCode remote host stopped')
    this.setStatus({
      addresses: [],
      boundPort: null,
      connectedClientCount: 0,
      enabled: false,
      error: null,
      lifecycleState: 'stopped',
      port: null,
      primaryUrl: null,
      remoteUrl: null,
      urls: [],
    })
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>) {
    const result = this.lifecycleQueue.catch(() => undefined).then(operation)
    this.lifecycleQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async updateNetwork(input: UpdateRemoteNetworkInput) {
    if (this.options.portOverride !== undefined) throw new Error('Remote port is overridden by TIDECODE_REMOTE_PORT for this process.')
    if (!Number.isInteger(input.port) || input.port < MIN_REMOTE_PORT || input.port > MAX_REMOTE_PORT) {
      throw new Error(`Remote port must be between ${MIN_REMOTE_PORT} and ${MAX_REMOTE_PORT}.`)
    }
    return this.enqueueLifecycle(async () => {
      const previous = { ...this.configuration }
      const next = { ...previous, port: input.port }
      if (previous.port === next.port) return this.getStatus()
      this.setStatus({ lifecycleState: 'restarting', error: null })
      await this.stopServer('TideCode remote port changed')
      try {
        const status = await this.startWithConfiguration(next, 'restarting')
        await writeRemoteConfiguration(next)
        return status
      } catch (error) {
        await this.stopServer('Restoring previous TideCode Remote port').catch((stopError) => {
          console.error('Failed to stop TideCode Remote before restoring the previous port.', stopError)
        })
        await this.startWithConfiguration(previous, 'restarting').catch((restoreError) => {
          console.error('Failed to restore the previous TideCode Remote port.', restoreError)
        })
        throw error
      }
    })
  }

  private invalidateWebSessions(reason: string) {
    this.sessions.clear()
    for (const socket of this.clients) socket.close(4001, reason)
  }

  async updateWebAuth(input: UpdateRemoteWebAuthInput) {
    const username = input.username.trim().slice(0, 128)
    if (input.enabled && username.length === 0) throw new Error('Remote username is required when web login is enabled.')
    if (input.password !== undefined && input.password.length > 0) {
      await setRemotePassword(input.password)
      this.credentialsConfigured = true
    } else {
      this.credentialsConfigured = await hasRemoteCredential()
    }
    if (input.enabled && !this.credentialsConfigured) throw new Error('Set a Remote password before enabling web login.')

    const previous = { ...this.configuration }
    const next = { ...previous, webAuthEnabled: input.enabled, webUsername: username }
    await writeRemoteConfiguration(next)
    this.configuration = next
    const boundaryChanged = previous.webAuthEnabled !== next.webAuthEnabled || previous.webUsername !== next.webUsername || Boolean(input.password)
    if (boundaryChanged) this.invalidateWebSessions('TideCode Remote authentication changed')
    this.setStatus({ webAuthEnabled: next.webAuthEnabled, webCredentialsConfigured: this.credentialsConfigured })
    return this.getStatus()
  }

  async clearWebCredentials() {
    await clearRemotePassword()
    this.credentialsConfigured = false
    this.configuration = await writeRemoteConfiguration({ ...this.configuration, webAuthEnabled: false, webUsername: '' })
    this.invalidateWebSessions('TideCode Remote credentials were cleared')
    this.setStatus({ webAuthEnabled: false, webCredentialsConfigured: false })
    return this.getStatus()
  }

  private getClientAddress(request: IncomingMessage) {
    return request.socket.remoteAddress ?? 'unknown'
  }

  private isLoginRateLimited(request: IncomingMessage) {
    const key = this.getClientAddress(request)
    const entry = this.loginFailures.get(key)
    if (!entry) return false
    if (Date.now() - entry.firstFailureAt > LOGIN_FAILURE_WINDOW_MS) {
      this.loginFailures.delete(key)
      return false
    }
    return entry.count >= MAX_LOGIN_FAILURES
  }

  private recordLoginFailure(request: IncomingMessage) {
    const key = this.getClientAddress(request)
    const current = this.loginFailures.get(key)
    const now = Date.now()
    if (!current || now - current.firstFailureAt > LOGIN_FAILURE_WINDOW_MS) {
      this.loginFailures.set(key, { count: 1, firstFailureAt: now })
      return
    }
    this.loginFailures.set(key, { count: current.count + 1, firstFailureAt: current.firstFailureAt })
  }

  private clearLoginFailures(request: IncomingMessage) {
    this.loginFailures.delete(this.getClientAddress(request))
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? '/', 'http://tidecode.local')
    if (requestUrl.pathname === '/remote/health') {
      writeJson(response, 200, {
        access: this.configuration.webAuthEnabled ? 'authenticated' : 'lan-unauthenticated',
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        status: 'ok',
        webAuthEnabled: this.configuration.webAuthEnabled,
      })
      return
    }

    if (requestUrl.pathname === '/remote/auth/status') {
      writeJson(response, 200, {
        authenticated: !this.configuration.webAuthEnabled || this.sessions.validate(request) !== null,
        credentialsConfigured: this.credentialsConfigured,
        required: this.configuration.webAuthEnabled,
      })
      return
    }

    if (requestUrl.pathname === '/remote/auth/logout' && request.method === 'POST') {
      this.sessions.delete(request, response)
      await this.sessions.flush()
      writeJson(response, 200, { ok: true })
      return
    }

    if (requestUrl.pathname === '/remote/auth/login' && request.method === 'POST') {
      if (!this.configuration.webAuthEnabled) {
        writeJson(response, 400, { error: 'Remote web login is not enabled.' })
        return
      }
      if (!this.credentialsConfigured) {
        writeJson(response, 503, { error: 'Remote login is not configured on the desktop app.' })
        return
      }
      if (this.isLoginRateLimited(request)) {
        writeJson(response, 429, { error: 'Too many sign-in attempts. Try again in a minute.' })
        return
      }
      let body: unknown
      try {
        body = await readAuthJsonBody(request)
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid request.' })
        return
      }
      const username = body && typeof body === 'object' && 'username' in body && typeof (body as { username?: unknown }).username === 'string'
        ? (body as { username: string }).username.trim()
        : ''
      const password = body && typeof body === 'object' && 'password' in body && typeof (body as { password?: unknown }).password === 'string'
        ? (body as { password: string }).password
        : ''
      const rememberMe = body && typeof body === 'object' && 'rememberMe' in body && typeof (body as { rememberMe?: unknown }).rememberMe === 'boolean'
        ? (body as { rememberMe: boolean }).rememberMe
        : true
      const valid = username === this.configuration.webUsername && await verifyRemotePassword(password)
      if (!valid) {
        this.recordLoginFailure(request)
        writeJson(response, 401, { error: 'Invalid username or password.' })
        return
      }
      this.clearLoginFailures(request)
      this.sessions.create(request, response, rememberMe)
      await this.sessions.flush()
      writeJson(response, 200, { ok: true })
      return
    }

    if (this.configuration.webAuthEnabled && this.sessions.validate(request) === null) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writeJson(response, 401, { error: 'Authentication required.' })
        return
      }
      const html = getLoginPageHtml(this.credentialsConfigured)
      response.writeHead(this.credentialsConfigured ? 200 : 503, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : html)
      return
    }

    if (this.options.devServerUrl) {
      await this.proxyHttpRequest(request, response, this.options.devServerUrl)
      return
    }

    await this.serveRendererFile(requestUrl.pathname, response)
  }

  private async proxyHttpRequest(request: IncomingMessage, response: ServerResponse, targetBase: string) {
    const target = new URL(request.url ?? '/', targetBase)
    const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest
    const proxy = requestImpl(target, {
      headers: { ...request.headers, host: target.host },
      method: request.method,
    }, (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers)
      proxyResponse.pipe(response)
    })
    proxy.on('error', (error) => {
      console.error('TideCode remote Vite proxy failed.', error)
      if (!response.headersSent) response.writeHead(502)
      response.end('Unable to reach TideCode development server.')
    })
    request.pipe(proxy)
  }

  private async serveRendererFile(urlPath: string, response: ServerResponse) {
    const rendererRoot = path.resolve(this.options.rendererDist)
    const decodedPath = decodeURIComponent(urlPath).replace(/^\/+/, '')
    const requestedPath = path.resolve(rendererRoot, decodedPath || 'index.html')
    const allowedPrefix = rendererRoot.endsWith(path.sep) ? rendererRoot : rendererRoot + path.sep
    let filePath = requestedPath === rendererRoot || requestedPath.startsWith(allowedPrefix)
      ? requestedPath
      : path.join(rendererRoot, 'index.html')

    try {
      const stat = await fs.stat(filePath)
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
      await fs.access(filePath)
    } catch {
      filePath = path.join(rendererRoot, 'index.html')
    }

    const content = await fs.readFile(filePath)
    response.writeHead(200, {
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      'Content-Type': getContentType(filePath),
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(content)
  }

  private async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const requestUrl = new URL(request.url ?? '/', 'http://tidecode.local')
    const sessionId = this.configuration.webAuthEnabled ? this.sessions.validate(request) : null
    if (this.configuration.webAuthEnabled && !sessionId) {
      writeUpgradeError(socket, 401, 'Unauthorized')
      return
    }

    if (requestUrl.pathname !== '/remote/ws') {
      if (this.options.devServerUrl) {
        this.proxyDevUpgrade(request, socket, head, this.options.devServerUrl)
      } else {
        writeUpgradeError(socket, 404, 'Not Found')
      }
      return
    }

    const originAllowed = sessionId
      ? this.sessions.matchesOrigin(sessionId, request) || isSameOriginRequest(request)
      : isSameOriginRequest(request)
    if (!originAllowed) {
      writeUpgradeError(socket, 403, 'Forbidden')
      return
    }
    const webSocketServer = this.webSocketServer
    if (!webSocketServer) {
      writeUpgradeError(socket, 503, 'Service Unavailable')
      return
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => this.acceptClient(client, sessionId))
  }

  private proxyDevUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, targetBase: string) {
    const target = new URL(targetBase)
    if (target.protocol !== 'http:') {
      writeUpgradeError(socket, 502, 'Unsupported Dev Proxy')
      return
    }
    const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
      let headers = `${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1\r\n`
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue
        headers += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`
      }
      headers += '\r\n'
      upstream.write(headers)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
  }

  private scheduleClientSessionExpiry(socket: WebSocket, sessionId: string) {
    const remainingMs = this.sessions.getRemainingMs(sessionId)
    if (remainingMs <= 0) {
      socket.close(4001, 'TideCode Remote session expired')
      return
    }
    const timer = setTimeout(() => {
      this.clientSessionTimers.delete(socket)
      this.scheduleClientSessionExpiry(socket, sessionId)
    }, Math.min(remainingMs, 2_147_000_000))
    this.clientSessionTimers.set(socket, timer)
  }

  private acceptClient(socket: WebSocket, sessionId: string | null) {
    this.clients.add(socket)
    if (sessionId) this.scheduleClientSessionExpiry(socket, sessionId)
    this.setStatus({ connectedClientCount: this.clients.size })
    socket.on('message', (raw) => this.handleClientMessage(socket, raw))
    socket.on('close', () => {
      this.clients.delete(socket)
      const timer = this.clientSessionTimers.get(socket)
      if (timer) clearTimeout(timer)
      this.clientSessionTimers.delete(socket)
      this.setStatus({ connectedClientCount: this.clients.size })
    })
    socket.send(JSON.stringify({ kind: 'ready', protocolVersion: REMOTE_PROTOCOL_VERSION }))
  }

  private notifyRemoteMutation(namespace: string, method: string, args: unknown[], result: unknown, window: BrowserWindow) {
    const historyMutations = new Set([
      'appendMessages',
      'createConversation',
      'createFolder',
      'createFolderFromPath',
      'deleteConversation',
      'deleteFolder',
      'moveFolder',
      'renameFolder',
      'reorderFolder',
      'replaceMessages',
      'updateConversationArchived',
      'updateConversationPinned',
      'updateConversationTitle',
    ])
    if (namespace === 'tidecodeHistory' && historyMutations.has(method)) {
      let conversationId: string | null = null
      if (method === 'createConversation' && result && typeof result === 'object' && 'id' in result && typeof (result as { id?: unknown }).id === 'string') {
        conversationId = (result as { id: string }).id
      } else if ((method === 'appendMessages' || method === 'replaceMessages') && args[0] && typeof args[0] === 'object' && 'conversationId' in args[0]) {
        const candidateId = (args[0] as { conversationId?: unknown }).conversationId
        conversationId = typeof candidateId === 'string' ? candidateId : null
      } else if (['deleteConversation', 'updateConversationArchived', 'updateConversationPinned', 'updateConversationTitle'].includes(method)) {
        conversationId = typeof args[0] === 'string' ? args[0] : null
      }
      const payload = {
        activateConversation: ['appendMessages', 'createConversation', 'replaceMessages'].includes(method),
        conversationId,
        method,
      }
      window.webContents.send('history:remoteChanged', payload)
      this.broadcastEvent({ channel: REMOTE_EVENT_CHANNELS.historyChanged, payload })
      return
    }
    if (namespace === 'tidecodeTerminal' && method === 'closeSession') {
      const input = args[0]
      if (!input || typeof input !== 'object') return
      const sessionId = 'sessionId' in input && typeof (input as { sessionId?: unknown }).sessionId === 'number'
        ? (input as { sessionId: number }).sessionId
        : null
      if (sessionId === null) return
      const tabKey = 'tabKey' in input && typeof (input as { tabKey?: unknown }).tabKey === 'string'
        ? (input as { tabKey: string }).tabKey
        : null
      if (!tabKey) return
      const payload = {
        sessionId,
        tabKey,
        workspaceRootPath: 'workspaceRootPath' in input && typeof (input as { workspaceRootPath?: unknown }).workspaceRootPath === 'string'
          ? (input as { workspaceRootPath: string }).workspaceRootPath
          : null,
      }
      window.webContents.send('terminal:remoteTabClosed', payload)
      this.broadcastEvent({ channel: REMOTE_EVENT_CHANNELS.terminalTabClosed, payload })
    }
  }

  private handleClientMessage(socket: WebSocket, raw: RawData) {
    let value: unknown
    try {
      value = JSON.parse(raw.toString())
    } catch {
      this.sendRpcError(socket, '', 'Malformed JSON request.')
      return
    }
    if (!isRemoteRpcRequest(value)) {
      const id = value && typeof value === 'object' && 'id' in value && typeof (value as { id?: unknown }).id === 'string'
        ? (value as { id: string }).id
        : ''
      this.sendRpcError(socket, id, 'Unsupported or invalid remote protocol request.')
      return
    }

    const window = this.options.getWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      this.sendRpcError(socket, value.id, 'The TideCode desktop window is unavailable.')
      return
    }

    const bridgeRequest = {
      args: value.args,
      id: value.id,
      method: value.method,
      namespace: value.namespace,
    }
    const requestJson = JSON.stringify(bridgeRequest)
    const expression = `(() => { const dispatch = globalThis.__tidecodeRemoteDispatch; if (typeof dispatch !== 'function') throw new Error('The TideCode desktop bridge is not ready.'); return dispatch(JSON.parse(${JSON.stringify(requestJson)})); })()`
    void window.webContents.executeJavaScript(expression, true)
      .then((result) => {
        this.notifyRemoteMutation(value.namespace, value.method, value.args, result, window)
        if (socket.readyState !== WebSocket.OPEN) return
        const response: RemoteRpcResponse = {
          id: value.id,
          kind: 'rpc-result',
          ok: true,
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          result,
        }
        socket.send(JSON.stringify(response))
      })
      .catch((error) => {
        this.sendRpcError(
          socket,
          value.id,
          error instanceof Error ? error.message : String(error),
        )
      })
  }

  private sendRpcError(socket: WebSocket, id: string, error: string) {
    if (socket.readyState !== WebSocket.OPEN) return
    const response: RemoteRpcResponse = {
      error,
      id,
      kind: 'rpc-result',
      ok: false,
      protocolVersion: REMOTE_PROTOCOL_VERSION,
    }
    socket.send(JSON.stringify(response))
  }

  broadcastEvent(event: RemoteBridgeEvent) {
    const message = JSON.stringify({
      channel: event.channel,
      kind: 'event',
      payload: event.payload,
      protocolVersion: REMOTE_PROTOCOL_VERSION,
    })
    for (const socket of this.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }
}
