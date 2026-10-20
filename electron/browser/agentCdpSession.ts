import type { WebContents } from 'electron'

type CdpParameters = Record<string, unknown>
export type CdpSend = (method: string, parameters?: CdpParameters) => Promise<unknown>
interface DiagnosticParameters {
  type?: string
  args?: Array<{ value?: unknown; description?: string; type?: string }>
  exceptionDetails?: { text?: string; exception?: { description?: string } }
  entry?: { level?: string; text?: string }
  errorText?: string
  response?: { status?: number; url?: string; statusText?: string }
  request?: { method?: string; url?: string }
}
export interface BrowserDiagnosticEvent {
  time: number
  category: 'console' | 'network'
  level: string
  message: string
}

interface SessionState {
  contents: WebContents
  events: BrowserDiagnosticEvent[]
  initialized: boolean
}

const MAX_EVENTS = 200
const sessions = new Map<number, SessionState>()

export function scrubBrowserDiagnosticText(text: string): string {
  return text.slice(0, 2000)
    .replace(/Bearer\s+[-\w.]+/giu, 'Bearer [redacted]')
    .replace(/(authorization|cookie|set-cookie|token|password|secret|api[-_]?key)\s*[:=]\s*["']?[^,\s;"']+/giu, '$1=[redacted]')
    .replace(/(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/giu, '$1?[redacted]')
}

function remember(state: SessionState, event: BrowserDiagnosticEvent) {
  state.events.push(event)
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
}

function recordCdpEvent(state: SessionState, method: string, params: DiagnosticParameters) {
  if (method === 'Runtime.consoleAPICalled') {
    remember(state, {
      time: Date.now(), category: 'console', level: params.type || 'log',
      message: scrubBrowserDiagnosticText((params.args || []).map((arg) =>
        String(arg.value ?? arg.description ?? arg.type ?? '')).join(' ')),
    })
  } else if (method === 'Runtime.exceptionThrown') {
    remember(state, {
      time: Date.now(), category: 'console', level: 'error',
      message: scrubBrowserDiagnosticText(String(params.exceptionDetails?.text ?? '')
        + ' ' + String(params.exceptionDetails?.exception?.description ?? '')),
    })
  } else if (method === 'Log.entryAdded') {
    remember(state, {
      time: Date.now(), category: 'console', level: params.entry?.level || 'info',
      message: scrubBrowserDiagnosticText(String(params.entry?.text ?? '')),
    })
  } else if (method === 'Network.requestWillBeSent') {
    remember(state, {
      time: Date.now(), category: 'network', level: 'request',
      message: scrubBrowserDiagnosticText(String(params.request?.method ?? 'GET')
        + ' ' + String(params.request?.url ?? '')),
    })
  } else if (method === 'Network.loadingFailed') {
    remember(state, {
      time: Date.now(), category: 'network', level: 'failed',
      message: scrubBrowserDiagnosticText(String(params.errorText ?? 'Network request failed')),
    })
  } else if (method === 'Network.responseReceived') {
    const response = params.response ?? {}
    remember(state, {
      time: Date.now(), category: 'network',
      level: String(response.status ?? 'response'),
      message: scrubBrowserDiagnosticText(String(response.url ?? '').split('#')[0] + ' ' + String(response.statusText ?? '')),
    })
  }
}

function ensureState(contents: WebContents): SessionState {
  if (contents.isDestroyed()) throw new Error('The browser tab is no longer available.')
  let state = sessions.get(contents.id)
  if (state) return state
  state = { contents, events: [], initialized: false }
  sessions.set(contents.id, state)
  const current = state
  contents.debugger.on('message', (_event, method, params) => recordCdpEvent(current, method, params))
  contents.debugger.on('detach', () => { current.initialized = false })
  contents.once('destroyed', () => sessions.delete(contents.id))
  return state
}

export async function withBrowserProtocol<T>(
  contents: WebContents,
  operation: (send: CdpSend) => Promise<T>,
): Promise<T> {
  const state = ensureState(contents)
  if (contents.isDevToolsOpened()) {
    throw new Error('Close the visible DevTools window before browser automation. Its debugging connection is exclusive.')
  }
  const debuggerApi = contents.debugger
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3')
    state.initialized = false
  }
  const send: CdpSend = (method, parameters = {}) => debuggerApi.sendCommand(method, parameters)
  if (!state.initialized) {
    await send('Runtime.enable')
    await send('Log.enable')
    await send('Network.enable', { maxTotalBufferSize: 1024 * 1024, maxResourceBufferSize: 256 * 1024 })
    await send('Page.enable')
    await send('DOM.enable')
    state.initialized = true
  }
  return operation(send)
}

export function releaseBrowserProtocol(contents: WebContents) {
  if (!contents.isDestroyed() && contents.debugger.isAttached()) {
    contents.debugger.detach()
  }
}

export function listBrowserDiagnosticEvents(contents: WebContents, category: BrowserDiagnosticEvent['category'], limit = 50) {
  return [...(sessions.get(contents.id)?.events ?? [])].filter((entry) => entry.category === category).slice(-limit)
}
