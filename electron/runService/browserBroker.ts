import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import type { BrowserHostRequest, BrowserHostResponse } from './browserService'

const REQUEST_TIMEOUT_MS = 45_000
const MAX_BROWSER_REPLY_BYTES = 16 * 1024 * 1024

interface PendingBrowserRequest {
  host: Socket
  resolve: (value: BrowserHostResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  disposeAbort: () => void
}

export interface BrowserHostReply {
  requestId: string
  ok: boolean
  result?: BrowserHostResponse
  error?: string
}

/** The desktop owns all Electron webContents. The run service never opens Chromium directly. */
export class RunServiceBrowserBroker {
  private host: Socket | null = null
  private readonly pending = new Map<string, PendingBrowserRequest>()

  constructor(private readonly requestTimeoutMs = REQUEST_TIMEOUT_MS) {}

  register(host: Socket) {
    if (this.host && this.host !== host) {
      this.disconnect(this.host)
    }
    this.host = host
  }

  disconnect(host: Socket) {
    if (this.host === host) this.host = null
    for (const [id, request] of this.pending) {
      if (request.host !== host) continue
      this.pending.delete(id)
      clearTimeout(request.timer)
      request.disposeAbort()
      request.reject(new Error('TideCode desktop browser host disconnected. Reconnect the desktop application and retry.'))
    }
  }

  close() {
    if (this.host) this.disconnect(this.host)
  }

  async request(input: BrowserHostRequest, signal?: AbortSignal): Promise<BrowserHostResponse> {
    if (signal?.aborted) throw new Error('Browser operation cancelled.')
    const host = this.host
    if (!host || host.destroyed) {
      throw new Error('TideCode browser automation needs a connected desktop browser host. Open TideCode Desktop and reconnect the run service.')
    }
    const requestId = randomUUID()
    return new Promise<BrowserHostResponse>((resolve, reject) => {
      const cancel = () => {
        this.pending.delete(requestId)
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        try {
          if (!host.destroyed) host.write(JSON.stringify({ type: 'browser_cancel', requestId }) + '\n')
        } catch {
          // The request is already cancelled; an unavailable socket cannot undo it.
        }
        reject(new Error('Browser operation cancelled.'))
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        signal?.removeEventListener('abort', cancel)
        try {
          if (!host.destroyed) host.write(JSON.stringify({ type: 'browser_cancel', requestId }) + '\n')
        } catch {
          // Preserve the timeout error even if the host disconnected.
        }
        const target = 'tabId' in input ? ' on tab ' + input.tabId : ''
        reject(new Error('Desktop browser host did not reply to ' + input.operation + target
          + ' within ' + this.requestTimeoutMs + 'ms. This request timed out; it does not establish that the desktop disconnected.'))
      }, this.requestTimeoutMs)
      timer.unref?.()
      this.pending.set(requestId, { host, resolve, reject, timer, disposeAbort: () => signal?.removeEventListener('abort', cancel) })
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) {
        cancel()
        return
      }
      try {
        host.write(JSON.stringify({ type: 'browser_request', requestId, input }) + '\n')
      } catch (error) {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        this.pending.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  receive(host: Socket, reply: BrowserHostReply) {
    if (host !== this.host || typeof reply?.requestId !== 'string') {
      throw new Error('Browser response came from an unregistered desktop host.')
    }
    const pending = this.pending.get(reply.requestId)
    if (!pending || pending.host !== host) return
    this.pending.delete(reply.requestId)
    clearTimeout(pending.timer)
    pending.disposeAbort()
    if (!reply.ok) {
      pending.reject(new Error(reply.error || 'TideCode browser operation failed.'))
      return
    }
    if (!reply.result || JSON.stringify(reply.result).length > MAX_BROWSER_REPLY_BYTES) {
      pending.reject(new Error('The desktop browser result is missing or exceeds the size limit.'))
      return
    }
    pending.resolve(reply.result)
  }
}
