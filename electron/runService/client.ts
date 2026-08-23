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

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
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

  constructor(private readonly expectedBuildId?: string) {}

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

      const hello = await this.requestRaw<RunServiceHello>('hello')
      if (hello.protocolVersion !== RUN_SERVICE_PROTOCOL_VERSION) {
        socket.destroy()
        if (this.socket === socket) this.socket = null
        throw new Error(
          `Tidecode run-service protocol mismatch: expected ${RUN_SERVICE_PROTOCOL_VERSION}, got ${hello.protocolVersion}.`,
        )
      }
      if (this.expectedBuildId && hello.buildId !== this.expectedBuildId) {
        await this.requestRaw<null>('shutdown').catch(() => undefined)
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
    return this.requestRaw<ChatCompactionLifecycleState | null>('getCompactionState', { conversationId })
  }

  async getConversationRuntime(conversationId: string, surface: AppSettingsSurface = 'desktop') {
    await this.connect()
    return this.requestRaw<SharedConversationRuntimeSnapshot | null>('getConversationRuntime', { conversationId, surface })
  }

  async getPendingFollowUps(streamId: string) {
    await this.connect()
    return this.requestRaw<SharedFollowUpSnapshot | null>('getPendingFollowUps', { streamId })
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

  async cancelStream(streamId: string, cancellation: ChatStreamCancellation = {
    policy: 'terminate',
    reason: 'user_stop',
    requestedAt: Date.now(),
    surface: 'desktop',
  }) {
    await this.connect()
    await this.requestRaw<null>('cancelStream', { cancellation, streamId })
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

  async terminalCreateSession(input: Omit<TerminalBrokerCreateSessionInput, 'clientId'>) {
    await this.connect()
    return this.requestRaw<TerminalBrokerCreateSessionResult>('terminalCreateSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalAttachSession(input: Omit<TerminalBrokerAttachInput, 'clientId'>) {
    await this.connect()
    return this.requestRaw<TerminalBrokerAttachResult>('terminalAttachSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalDetachSession(input: Omit<TerminalBrokerSessionReference, 'clientId'>) {
    await this.connect()
    return this.requestRaw<TerminalBrokerSessionSnapshot>('terminalDetachSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalListSessions() {
    await this.connect()
    return this.requestRaw<TerminalBrokerSessionSnapshot[]>('terminalListSessions', {
      clientId: this.terminalClientId,
    })
  }

  async terminalGetSession(input: Omit<TerminalBrokerSessionReference, 'clientId'>) {
    await this.connect()
    return this.requestRaw<TerminalBrokerSessionSnapshot>('terminalGetSession', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalRead(input: Omit<TerminalBrokerReadInput, 'clientId'>) {
    await this.connect()
    return this.requestRaw<TerminalBrokerAttachResult>('terminalRead', {
      ...input,
      clientId: this.terminalClientId,
    })
  }

  async terminalWrite(input: Omit<TerminalBrokerWriteInput, 'clientId'>) {
    await this.connect()
    await this.requestRaw<null>('terminalWrite', { ...input, clientId: this.terminalClientId })
  }

  async terminalResize(input: Omit<TerminalBrokerResizeInput, 'clientId'>) {
    await this.connect()
    await this.requestRaw<null>('terminalResize', { ...input, clientId: this.terminalClientId })
  }

  async terminalTerminate(input: Omit<TerminalBrokerTerminateInput, 'clientId'>) {
    await this.connect()
    return this.requestRaw<TerminalBrokerSessionSnapshot>('terminalTerminate', {
      ...input,
      clientId: this.terminalClientId,
    })
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
