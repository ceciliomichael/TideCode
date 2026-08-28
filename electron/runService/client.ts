import { randomUUID } from 'node:crypto'
import net from 'node:net'
import type {
  AppSettingsSurface,
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
  TerminalBrokerAttachInput,
  TerminalBrokerAttachResult,
  TerminalBrokerCreateSessionInput,
  TerminalBrokerCreateSessionResult,
  TerminalBrokerEvent,
  TerminalBrokerReadInput,
  TerminalBrokerResizeInput,
  TerminalBrokerSessionReference,
  TerminalBrokerSessionSnapshot,
  TerminalBrokerTerminateInput,
  TerminalBrokerWriteInput,
  ChatStreamCancellation,
} from '../../src/types/chat'
import {
  RUN_SERVICE_PROTOCOL_VERSION,
  type RunServiceHello,
  type RunServiceResponse,
  type RunServiceWireMessage,
} from './protocol'
import { ensureRunServiceToken, getRunServiceEndpoint } from './paths'

const RUN_SERVICE_CONNECT_TIMEOUT_MS = 2_000
const RUN_SERVICE_HANDSHAKE_TIMEOUT_MS = 2_000
const RUN_SERVICE_CONTROL_TIMEOUT_MS = 60_000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeoutId?: NodeJS.Timeout
}

export class RunServiceBuildMismatchError extends Error {
  constructor(expectedBuildId: string, actualBuildId: string) {
    super(`Tidecode run-service build mismatch: expected ${expectedBuildId}, got ${actualBuildId || 'missing'}.`)
    this.name = 'RunServiceBuildMismatchError'
  }
}

export class TideCodeRunServiceClient {
  private socket: net.Socket | null = null
  private connectPromise: Promise<void> | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<(event: TideCodeRunEvent) => void>()
  private readonly terminalEventListeners = new Set<(event: TerminalBrokerEvent) => void>()
  readonly terminalClientId = randomUUID()
  private buffered = ''
  private token = ''
  private serviceProcessId: number | null = null

  constructor(private readonly expectedBuildId?: string) {}

  get processId() {
    return this.serviceProcessId
  }

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
          const cleanup = () => {
            clearTimeout(timeoutId)
            socket.off('connect', onConnect)
            socket.off('error', onError)
          }
          const onConnect = () => {
            cleanup()
            resolve()
          }
          const onError = (error: Error) => {
            cleanup()
            reject(error)
          }
          socket.once('connect', onConnect)
          socket.once('error', onError)
          const timeoutId = setTimeout(() => {
            cleanup()
            socket.destroy()
            reject(new Error(`Timed out connecting to the Tidecode run service after ${RUN_SERVICE_CONNECT_TIMEOUT_MS}ms.`))
          }, RUN_SERVICE_CONNECT_TIMEOUT_MS)
          timeoutId.unref?.()
        })
      } catch (error) {
        socket.destroy()
        if (this.socket === socket) this.socket = null
        throw error
      }

      socket.on('data', (chunk: string) => this.handleData(chunk))
      socket.on('error', (error) => this.handleDisconnect(error))
      socket.on('close', () => this.handleDisconnect(new Error('Tidecode run service disconnected.')))

      const hello = await this.requestRaw<RunServiceHello>('hello', undefined, RUN_SERVICE_HANDSHAKE_TIMEOUT_MS)
      this.serviceProcessId = Number.isInteger(hello.processId) && (hello.processId ?? 0) > 0
        ? hello.processId ?? null
        : null
      if (hello.protocolVersion !== RUN_SERVICE_PROTOCOL_VERSION) {
        socket.destroy()
        if (this.socket === socket) this.socket = null
        throw new Error(
          `Tidecode run-service protocol mismatch: expected ${RUN_SERVICE_PROTOCOL_VERSION}, got ${hello.protocolVersion}.`,
        )
      }
      if (this.expectedBuildId && hello.buildId !== this.expectedBuildId) {
        await this.requestRaw<null>('shutdown', undefined, RUN_SERVICE_HANDSHAKE_TIMEOUT_MS).catch(() => undefined)
        socket.destroy()
        if (this.socket === socket) this.socket = null
        throw new RunServiceBuildMismatchError(this.expectedBuildId, hello.buildId)
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

  onTerminalEvent(listener: (event: TerminalBrokerEvent) => void) {
    this.terminalEventListeners.add(listener)
    return () => this.terminalEventListeners.delete(listener)
  }

  async getCompactionState(conversationId: string) {
    await this.connect()
    return this.requestControlRaw<ChatCompactionLifecycleState | null>('getCompactionState', { conversationId })
  }

  async getConversationRuntime(conversationId: string, surface: AppSettingsSurface = 'desktop') {
    await this.connect()
    return this.requestControlRaw<SharedConversationRuntimeSnapshot | null>('getConversationRuntime', { conversationId, surface })
  }

  async getPendingFollowUps(streamId: string) {
    await this.connect()
    return this.requestControlRaw<SharedFollowUpSnapshot | null>('getPendingFollowUps', { streamId })
  }

  async getRunProjection(runId: string) {
    await this.connect()
    return this.requestControlRaw<SharedRunProjection | null>('getRunProjection', { runId })
  }

  async listActiveRuns() {
    await this.connect()
    return this.requestControlRaw<SharedRunSnapshot[]>('listActiveRuns')
  }

  async ensureWorkspaceProject(workspacePath: string) {
    await this.connect()
    return this.requestControlRaw<ConversationFolderRecord>('ensureWorkspaceProject', { workspacePath })
  }

  async appendMessages(input: AppendConversationMessagesInput) {
    await this.connect()
    return this.requestControlRaw<ConversationRecord>('appendMessages', input)
  }

  async replaceMessages(input: ReplaceConversationMessagesInput) {
    await this.connect()
    return this.requestControlRaw<ConversationRecord>('replaceMessages', input)
  }

  async compactConversation(input: CompactConversationInput) {
    await this.connect()
    return this.requestRaw<CompactConversationResult>('compactConversation', input)
  }

  async startStream(input: StartChatStreamInput) {
    await this.connect()
    return this.requestRaw<StartChatStreamResult>('startStream', input)
  }

  async cancelStream(streamId: string, cancellation: ChatStreamCancellation = {
    policy: 'terminate',
    reason: 'user_stop',
    requestedAt: Date.now(),
    surface: 'desktop',
  }) {
    await this.connect()
    await this.requestControlRaw<null>('cancelStream', { cancellation, streamId })
  }

  async updatePendingSteerMessages(input: UpdatePendingSteerMessagesInput) {
    await this.connect()
    return this.requestControlRaw<UpdatePendingSteerMessagesResult>('updatePendingSteerMessages', input)
  }

  async updatePendingFollowUps(input: UpdateSharedFollowUpsInput) {
    await this.connect()
    return this.requestControlRaw<SharedFollowUpSnapshot>('updatePendingFollowUps', input)
  }

  async claimPendingFollowUps(input: ClaimSharedFollowUpsInput) {
    await this.connect()
    return this.requestControlRaw<ClaimSharedFollowUpsResult>('claimPendingFollowUps', input)
  }

  async submitToolDecision(input: SubmitToolDecisionInput) {
    await this.connect()
    return this.requestControlRaw<SubmitToolDecisionResult>('submitToolDecision', input)
  }

  async updateConversationRuntime(input: UpdateConversationRuntimeInput) {
    await this.connect()
    return this.requestControlRaw<SharedConversationRuntimeSnapshot>('updateConversationRuntime', input)
  }

  async terminalCreateSession(input: Omit<TerminalBrokerCreateSessionInput, 'clientId'>) {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerCreateSessionResult>('terminalCreateSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalAttachSession(input: Omit<TerminalBrokerAttachInput, 'clientId'>) {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerAttachResult>('terminalAttachSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalDetachSession(input: Omit<TerminalBrokerSessionReference, 'clientId'>) {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerSessionSnapshot>('terminalDetachSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalListSessions() {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerSessionSnapshot[]>('terminalListSessions', {
      clientId: this.terminalClientId,
    })
  }

  async terminalGetSession(input: Omit<TerminalBrokerSessionReference, 'clientId'>) {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerSessionSnapshot>('terminalGetSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalRead(input: Omit<TerminalBrokerReadInput, 'clientId'>) {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerAttachResult>('terminalRead', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalWrite(input: Omit<TerminalBrokerWriteInput, 'clientId'>) {
    await this.connect()
    await this.requestControlRaw<null>('terminalWrite', { ...input, clientId: this.terminalClientId })
  }

  async terminalResize(input: Omit<TerminalBrokerResizeInput, 'clientId'>) {
    await this.connect()
    await this.requestControlRaw<null>('terminalResize', { ...input, clientId: this.terminalClientId })
  }

  async terminalTerminate(input: Omit<TerminalBrokerTerminateInput, 'clientId'>) {
    await this.connect()
    return this.requestControlRaw<TerminalBrokerSessionSnapshot>('terminalTerminate', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async shutdown(timeoutMs = 5_000) {
    await this.connect()
    const socket = this.socket
    if (!socket || socket.destroyed) return

    const disconnected = new Promise<void>((resolve) => socket.once('close', () => resolve()))
    await this.requestRaw<null>('shutdown', undefined, Math.min(timeoutMs, RUN_SERVICE_HANDSHAKE_TIMEOUT_MS))
    await Promise.race([
      disconnected,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
    if (!socket.destroyed) socket.destroy()
    if (this.socket === socket) this.socket = null
  }

  close() {
    this.socket?.destroy()
    this.socket = null
  }

  private requestControlRaw<T>(method: string, params?: unknown): Promise<T> {
    return this.requestRaw<T>(method, params, RUN_SERVICE_CONTROL_TIMEOUT_MS)
  }

  private requestRaw<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.reject(new Error('Tidecode run service is not connected.'))

    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: (value) => resolve(value as T),
        reject,
      }
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        pending.timeoutId = setTimeout(() => {
          if (this.pending.get(id) !== pending) return
          this.pending.delete(id)
          reject(new Error(`Tidecode run-service request "${method}" timed out after ${timeoutMs}ms.`))
        }, timeoutMs)
        pending.timeoutId.unref?.()
      }
      this.pending.set(id, pending)
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
      if ('type' in message && message.type === 'terminal_event') {
        if (message.event.clientIds.includes(this.terminalClientId)) {
          for (const listener of this.terminalEventListeners) listener(message.event)
        }
        continue
      }

      const response = message as RunServiceResponse
      const pending = this.pending.get(response.id)
      if (!pending) continue
      this.pending.delete(response.id)
      if (pending.timeoutId) clearTimeout(pending.timeoutId)
      if (response.ok) pending.resolve(response.result)
      else pending.reject(new Error(response.error || 'Tidecode run-service request failed.'))
    }
  }

  private handleDisconnect(error: Error) {
    this.socket = null
    for (const pending of this.pending.values()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
