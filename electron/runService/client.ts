import { randomUUID } from 'node:crypto'
import net from 'node:net'
import type {
  SharedRunSnapshot,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
  TideCodeRunEvent,
  UpdatePendingSteerMessagesInput,
  UpdatePendingSteerMessagesResult,
} from '../../src/types/chat'
import { RUN_SERVICE_PROTOCOL_VERSION, type RunServiceResponse, type RunServiceWireMessage } from './protocol'
import { ensureRunServiceToken, getRunServiceEndpoint } from './paths'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class TideCodeRunServiceClient {
  private socket: net.Socket | null = null
  private connectPromise: Promise<void> | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<(event: TideCodeRunEvent) => void>()
  private buffered = ''
  private token = ''

  async connect() {
    if (this.socket && !this.socket.destroyed) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = (async () => {
      this.token = await ensureRunServiceToken()
      const socket = net.createConnection(getRunServiceEndpoint())
      socket.setEncoding('utf8')
      this.socket = socket

      try {
        await new Promise<void>((resolve, reject) => {
          const onConnect = () => {
            socket.off('error', onError)
            resolve()
          }
          const onError = (error: Error) => {
            socket.off('connect', onConnect)
            reject(error)
          }
          socket.once('connect', onConnect)
          socket.once('error', onError)
        })
      } catch (error) {
        socket.destroy()
        if (this.socket === socket) this.socket = null
        throw error
      }

      socket.on('data', (chunk: string) => this.handleData(chunk))
      socket.on('error', (error) => this.handleDisconnect(error))
      socket.on('close', () => this.handleDisconnect(new Error('Tidecode run service disconnected.')))

      const hello = await this.requestRaw<{ protocolVersion: number }>('hello')
      if (hello.protocolVersion !== RUN_SERVICE_PROTOCOL_VERSION) {
        throw new Error(
          `Tidecode run-service protocol mismatch: expected ${RUN_SERVICE_PROTOCOL_VERSION}, got ${hello.protocolVersion}.`,
        )
      }
    })().finally(() => {
      this.connectPromise = null
    })

    return this.connectPromise
  }

  onEvent(listener: (event: TideCodeRunEvent) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async listActiveRuns() {
    await this.connect()
    return this.requestRaw<SharedRunSnapshot[]>('listActiveRuns')
  }

  async startStream(input: StartChatStreamInput) {
    await this.connect()
    return this.requestRaw<StartChatStreamResult>('startStream', input)
  }

  async cancelStream(streamId: string) {
    await this.connect()
    await this.requestRaw<null>('cancelStream', { streamId })
  }

  async updatePendingSteerMessages(input: UpdatePendingSteerMessagesInput) {
    await this.connect()
    return this.requestRaw<UpdatePendingSteerMessagesResult>('updatePendingSteerMessages', input)
  }

  async submitToolDecision(input: SubmitToolDecisionInput) {
    await this.connect()
    return this.requestRaw<SubmitToolDecisionResult>('submitToolDecision', input)
  }

  close() {
    this.socket?.destroy()
    this.socket = null
  }

  private requestRaw<T>(method: string, params?: unknown): Promise<T> {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.reject(new Error('Tidecode run service is not connected.'))

    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      socket.write(`${JSON.stringify({ id, token: this.token, method, ...(params === undefined ? {} : { params }) })}\n`)
    })
  }

  private handleData(chunk: string) {
    this.buffered += chunk
    for (;;) {
      const newlineIndex = this.buffered.indexOf('\n')
      if (newlineIndex < 0) return
      const line = this.buffered.slice(0, newlineIndex).trim()
      this.buffered = this.buffered.slice(newlineIndex + 1)
      if (!line) continue

      let message: RunServiceWireMessage
      try {
        message = JSON.parse(line) as RunServiceWireMessage
      } catch {
        continue
      }

      if ('type' in message && message.type === 'event') {
        for (const listener of this.eventListeners) listener(message.event)
        continue
      }

      const response = message as RunServiceResponse
      const pending = this.pending.get(response.id)
      if (!pending) continue
      this.pending.delete(response.id)
      if (response.ok) pending.resolve(response.result)
      else pending.reject(new Error(response.error || 'Tidecode run-service request failed.'))
    }
  }

  private handleDisconnect(error: Error) {
    this.socket = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
