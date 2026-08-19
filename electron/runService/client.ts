import { randomUUID } from 'node:crypto'
import net from 'node:net'
import type {
  AppendConversationMessagesInput,
  ChatCompactionLifecycleState,
  CompactConversationInput,
  ClaimSharedFollowUpsInput,
  ClaimSharedFollowUpsResult,
  CompactConversationResult,
  ConversationFolderRecord,
  ConversationRecord,
  ReplaceConversationMessagesInput,
  SharedConversationRuntimeSnapshot,
  SharedFollowUpSnapshot,
  SharedRunProjection,
  SharedRunSnapshot,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
  TideCodeRunEvent,
  UpdateConversationRuntimeInput,
  UpdateSharedFollowUpsInput,
  UpdatePendingSteerMessagesInput,
  UpdatePendingSteerMessagesResult,
} from '../../src/types/chat'
import { RUN_SERVICE_PROTOCOL_VERSION, type RunServiceResponse, type RunServiceWireMessage } from './protocol'
import { ensureRunServiceToken, getRunServiceEndpoint } from './paths'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export interface RunServiceClientOptions {
  recoverService?: () => Promise<void>
  reconnectDelayMs?: number
  startupRetryCount?: number
  startupRetryDelayMs?: number
}

const DEFAULT_RECONNECT_DELAY_MS = 250
const DEFAULT_STARTUP_RETRY_COUNT = 60
const DEFAULT_STARTUP_RETRY_DELAY_MS = 50

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export class TideCodeRunServiceClient {
  private socket: net.Socket | null = null
  private connectPromise: Promise<void> | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<(event: TideCodeRunEvent) => void>()
  private buffered = ''
  private token = ''
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalClose = false

  constructor(private readonly options: RunServiceClientOptions = {}) {}

  async connect() {
    if (this.socket && !this.socket.destroyed) return
    if (this.connectPromise) return this.connectPromise

    this.intentionalClose = false
    this.connectPromise = this.connectWithRecovery().finally(() => {
      this.connectPromise = null
    })

    return this.connectPromise
  }

  private async connectWithRecovery() {
    try {
      await this.connectOnce()
      return
    } catch (firstError) {
      if (!this.options.recoverService) throw firstError

      await this.options.recoverService()
      let lastError: unknown = firstError
      const retryCount = this.options.startupRetryCount ?? DEFAULT_STARTUP_RETRY_COUNT
      const retryDelayMs = this.options.startupRetryDelayMs ?? DEFAULT_STARTUP_RETRY_DELAY_MS

      for (let attempt = 0; attempt < retryCount; attempt += 1) {
        await sleep(retryDelayMs)
        try {
          await this.connectOnce()
          return
        } catch (error) {
          lastError = error
        }
      }

      throw lastError
    }
  }

  private async connectOnce() {
    this.token = await ensureRunServiceToken()
    const socket = net.createConnection(getRunServiceEndpoint())
    socket.setEncoding('utf8')
    this.buffered = ''
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

    socket.on('data', (chunk: string) => {
      if (this.socket === socket) this.handleData(chunk)
    })
    socket.on('error', (error) => this.handleDisconnect(socket, error))
    socket.on('close', () => this.handleDisconnect(socket, new Error('Tidecode run service disconnected.')))

    try {
      const hello = await this.requestRaw<{ protocolVersion: number }>('hello')
      if (hello.protocolVersion !== RUN_SERVICE_PROTOCOL_VERSION) {
        throw new Error(
          `Tidecode run-service protocol mismatch: expected ${RUN_SERVICE_PROTOCOL_VERSION}, got ${hello.protocolVersion}.`,
        )
      }
    } catch (error) {
      if (this.socket === socket) this.socket = null
      socket.destroy()
      throw error
    }
  }

  onEvent(listener: (event: TideCodeRunEvent) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  async getCompactionState(conversationId: string) {
    await this.connect()
    return this.requestRaw<ChatCompactionLifecycleState | null>('getCompactionState', { conversationId })
  }

  async getConversationRuntime(conversationId: string) {
    await this.connect()
    return this.requestRaw<SharedConversationRuntimeSnapshot | null>('getConversationRuntime', { conversationId })
  }

  async getPendingFollowUps(streamId: string) {
    await this.connect()
    return this.requestRaw<SharedFollowUpSnapshot | null>('getPendingFollowUps', { streamId })
  }

  async getRunByStreamId(streamId: string) {
    await this.connect()
    return this.requestRaw<SharedRunSnapshot | null>('getRunByStreamId', { streamId })
  }

  async getRunProjection(runId: string) {
    await this.connect()
    return this.requestRaw<SharedRunProjection | null>('getRunProjection', { runId })
  }

  async listActiveRuns() {
    await this.connect()
    return this.requestRaw<SharedRunSnapshot[]>('listActiveRuns')
  }

  async ensureWorkspaceProject(workspacePath: string) {
    await this.connect()
    return this.requestRaw<ConversationFolderRecord>('ensureWorkspaceProject', { workspacePath })
  }

  async appendMessages(input: AppendConversationMessagesInput) {
    await this.connect()
    return this.requestRaw<ConversationRecord>('appendMessages', input)
  }

  async replaceMessages(input: ReplaceConversationMessagesInput) {
    await this.connect()
    return this.requestRaw<ConversationRecord>('replaceMessages', input)
  }

  async compactConversation(input: CompactConversationInput) {
    await this.connect()
    return this.requestRaw<CompactConversationResult>('compactConversation', input)
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

  async updatePendingFollowUps(input: UpdateSharedFollowUpsInput) {
    await this.connect()
    return this.requestRaw<SharedFollowUpSnapshot>('updatePendingFollowUps', input)
  }

  async claimPendingFollowUps(input: ClaimSharedFollowUpsInput) {
    await this.connect()
    return this.requestRaw<ClaimSharedFollowUpsResult>('claimPendingFollowUps', input)
  }

  async submitToolDecision(input: SubmitToolDecisionInput) {
    await this.connect()
    return this.requestRaw<SubmitToolDecisionResult>('submitToolDecision', input)
  }

  async updateConversationRuntime(input: UpdateConversationRuntimeInput) {
    await this.connect()
    return this.requestRaw<SharedConversationRuntimeSnapshot>('updateConversationRuntime', input)
  }

  close() {
    this.intentionalClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const socket = this.socket
    this.socket = null
    socket?.destroy()
    const error = new Error('Tidecode run-service client closed.')
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.buffered = ''
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

  private handleDisconnect(socket: net.Socket, error: Error) {
    if (this.socket !== socket) return
    this.socket = null
    this.buffered = ''
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    if (!this.intentionalClose && this.eventListeners.size > 0) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.intentionalClose) return
    const delayMs = this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch(() => this.scheduleReconnect())
    }, delayMs)
    this.reconnectTimer.unref?.()
  }
}
