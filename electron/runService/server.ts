import { randomUUID } from 'node:crypto'
import net from 'node:net'
import type { Socket } from 'node:net'
import type {
  ChatCompactionLifecycleState,
  ChatStreamEvent,
  CompactConversationInput,
  CompactConversationResult,
  ConversationRecord,
  SharedConversationRuntimeSnapshot,
  SharedFollowUpSnapshot,
  SharedRunProjection,
  SharedRunStatus,
  StartChatStreamInput,
  TideCodeRunEvent,
  UpdateConversationRuntimeInput,
} from '../../src/types/chat'
import {
  cancelApiKeyChatStream,
  compactApiKeyConversation,
  startApiKeyChatStream,
  submitApiKeyToolDecision,
  updateApiKeyPendingSteerMessages,
} from '../chat/apiKey/runtime'
import {
  cancelCodexChatStream,
  compactCodexConversation,
  startCodexChatStream,
  submitCodexToolDecision,
  updateCodexPendingSteerMessages,
} from '../chat/codex/runtime'
import type { ChatStreamEventTarget } from '../chat/shared/runtimeStreamEvents'
import { CliTurnMessageCollector } from '../cli/cliTurnMessageCollector'
import { appendStoredMessages, ensureStoredFolderFromPath, getStoredConversation, replaceStoredMessages, updateStoredConversationChatMode } from '../history/store'
import { getStoredSettings, updateStoredConversationModelPreference } from '../settings/store'
import type { CliSessionState } from '../cli/types'
import { RUN_SERVICE_PROTOCOL_VERSION, isRunServiceRequest, type RunServiceResponse } from './protocol'
import { ensureRunServiceToken, getRunServiceEndpoint, removeStaleRunServiceSocket } from './paths'
import { SharedFollowUpStore } from './followUpStore'
import { SharedRunRegistry } from './runRegistry'
import { SharedStreamPersistence } from './streamPersistence'
import { listCompactionMarkers } from '../chat/history/eventStore'
import { hasMinimumCompactionMessages, MIN_COMPACTION_MESSAGE_COUNT } from '../../src/lib/chatCompactionGate'

const TERMINAL_RUN_RETENTION_MS = 60_000
const TEXT_STREAM_IDLE_GRACE_MS = 1_500

export interface TideCodeRunServiceServerOptions {
  buildId: string
  onShutdownRequested?: () => void
}

function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : String(error)
}

function toCollectorState(input: StartChatStreamInput & { conversationId: string }): CliSessionState {
  return {
    activeStreamId: null,
    chatMode: input.chatMode,
    conversationId: input.conversationId,
    isStreaming: true,
    messages: [...input.messages],
    modelId: input.modelId,
    providerId: input.providerId,
    reasoningEffort: input.reasoningEffort,
    terminalExecutionMode: input.terminalExecutionMode,
    workspaceRootPath: input.agentContextRootPath,
  }
}

function terminalStatusForEvent(event: ChatStreamEvent): SharedRunStatus | null {
  if (event.type === 'completed') return 'completed'
  if (event.type === 'aborted') return 'cancelled'
  if (event.type === 'error') return 'failed'
  return null
}

async function canConnectToEndpoint(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint)
    const finish = (connected: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(connected)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function listenOnEndpoint(server: net.Server, endpoint: string) {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })
}

export class TideCodeRunServiceServer {
  private readonly server = net.createServer((socket) => this.acceptClient(socket))
  private readonly clients = new Set<Socket>()
  private readonly registry = new SharedRunRegistry()
  private readonly followUps = new SharedFollowUpStore()
  private readonly nextSeqByRunId = new Map<string, number>()
  private readonly projectionsByRunId = new Map<string, SharedRunProjection>()
  private readonly projectionTextIdleTimers = new Map<string, NodeJS.Timeout>()
  private readonly compactionStateByConversationId = new Map<string, ChatCompactionLifecycleState>()
  private readonly runtimeByConversationId = new Map<string, SharedConversationRuntimeSnapshot>()
  private nextConversationEventSeq = 0
  private token = ''

  constructor(private readonly options: TideCodeRunServiceServerOptions) {}

  async start() {
    this.token = await ensureRunServiceToken()
    const endpoint = getRunServiceEndpoint()

    try {
      await listenOnEndpoint(this.server, endpoint)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform === 'win32' || code !== 'EADDRINUSE') throw error
      if (await canConnectToEndpoint(endpoint)) throw error
      await removeStaleRunServiceSocket()
      await listenOnEndpoint(this.server, endpoint)
    }
  }

  async close() {
    for (const client of this.clients) client.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private acceptClient(socket: Socket) {
    this.clients.add(socket)
    socket.setEncoding('utf8')
    let buffered = ''

    socket.on('data', (chunk: string) => {
      buffered += chunk
      for (;;) {
        const newlineIndex = buffered.indexOf('\n')
        if (newlineIndex < 0) break
        const line = buffered.slice(0, newlineIndex).trim()
        buffered = buffered.slice(newlineIndex + 1)
        if (!line) continue
        void this.handleLine(socket, line)
      }
    })
    socket.on('close', () => this.clients.delete(socket))
    socket.on('error', () => this.clients.delete(socket))
  }

  private async handleLine(socket: Socket, line: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    if (!isRunServiceRequest(parsed)) return

    if (parsed.token !== this.token) {
      this.sendResponse(socket, { id: parsed.id, ok: false, error: 'Unauthorized Tidecode run-service client.' })
      return
    }

    try {
      switch (parsed.method) {
        case 'hello':
          this.sendResponse(socket, {
            id: parsed.id,
            ok: true,
            result: {
              buildId: this.options.buildId,
              protocolVersion: RUN_SERVICE_PROTOCOL_VERSION,
            },
          })
          return
        case 'shutdown':
          this.sendResponse(socket, { id: parsed.id, ok: true, result: null })
          queueMicrotask(() => this.options.onShutdownRequested?.())
          return
        case 'getCompactionState':
          this.sendResponse(socket, {
            id: parsed.id,
            ok: true,
            result: this.compactionStateByConversationId.get(parsed.params.conversationId) ?? null,
          })
          return
        case 'getConversationRuntime':
          this.sendResponse(socket, {
            id: parsed.id,
            ok: true,
            result: await this.getConversationRuntime(parsed.params.conversationId),
          })
          return
        case 'getPendingFollowUps':
          this.sendResponse(socket, { id: parsed.id, ok: true, result: this.followUps.get(parsed.params.streamId) })
          return
        case 'getRunProjection':
          this.sendResponse(socket, {
            id: parsed.id,
            ok: true,
            result: this.projectionsByRunId.get(parsed.params.runId) ?? null,
          })
          return
        case 'listActiveRuns':
          this.sendResponse(socket, { id: parsed.id, ok: true, result: this.registry.listActive() })
          return
        case 'ensureWorkspaceProject': {
          const folder = await ensureStoredFolderFromPath(parsed.params.workspacePath)
          this.emitGlobalEvent({ type: 'project_registered', seq: 0, folder })
          this.sendResponse(socket, { id: parsed.id, ok: true, result: folder })
          return
        }
        case 'appendMessages': {
          const conversation = await appendStoredMessages(parsed.params)
          this.emitConversationAppend(conversation)
          this.sendResponse(socket, { id: parsed.id, ok: true, result: conversation })
          return
        }
        case 'replaceMessages': {
          const conversation = await replaceStoredMessages(parsed.params)
          this.emitConversationReplacement(conversation)
          this.sendResponse(socket, { id: parsed.id, ok: true, result: conversation })
          return
        }
        case 'compactConversation': {
          const result = await this.compactConversation(parsed.params)
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
        case 'startStream': {
          const result = await this.startSharedStream(parsed.params)
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
        case 'cancelStream': {
          const providerId = this.registry.getProviderByStreamId(parsed.params.streamId)
          if (providerId === 'codex') await cancelCodexChatStream(parsed.params.streamId)
          else if (providerId) await cancelApiKeyChatStream(parsed.params.streamId)
          this.sendResponse(socket, { id: parsed.id, ok: true, result: null })
          return
        }
        case 'updatePendingSteerMessages': {
          const providerId = this.registry.getProviderByStreamId(parsed.params.streamId)
          const result = providerId === 'codex'
            ? updateCodexPendingSteerMessages(parsed.params)
            : providerId
              ? updateApiKeyPendingSteerMessages(parsed.params)
              : { accepted: false }
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
        case 'updatePendingFollowUps': {
          const snapshot = this.followUps.update(parsed.params.streamId, parsed.params.mutation)
          this.syncProviderSteers(snapshot)
          this.emitFollowUps(snapshot)
          this.sendResponse(socket, { id: parsed.id, ok: true, result: snapshot })
          return
        }
        case 'claimPendingFollowUps': {
          const run = this.registry.getByStreamId(parsed.params.streamId)
          if (!run) throw new Error('Unable to find the shared run for these follow-ups.')
          if (run.status === 'starting' || run.status === 'running' || run.status === 'waiting_for_input') {
            throw new Error('Follow-ups cannot be claimed until the active turn has ended.')
          }
          const result = this.followUps.claim(parsed.params.streamId)
          const snapshot = this.followUps.get(parsed.params.streamId)
          if (snapshot) this.emitFollowUps(snapshot)
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
        case 'submitToolDecision': {
          const providerId = this.registry.getProviderByStreamId(parsed.params.streamId)
          if (!providerId) throw new Error('Unable to determine which provider owns this shared run.')
          const result = providerId === 'codex'
            ? await submitCodexToolDecision(parsed.params)
            : await submitApiKeyToolDecision(parsed.params)
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
        case 'updateConversationRuntime': {
          const result = await this.updateConversationRuntime(parsed.params)
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
      }
    } catch (error) {
      this.sendResponse(socket, { id: parsed.id, ok: false, error: toErrorMessage(error) })
    }
  }

  private async getConversationRuntime(conversationId: string): Promise<SharedConversationRuntimeSnapshot | null> {
    const cached = this.runtimeByConversationId.get(conversationId)
    if (cached) return cached

    const conversation = await getStoredConversation(conversationId).catch(() => null)
    if (!conversation) return null
    const settings = await getStoredSettings().catch(() => null)
    const preference = settings?.conversationModelPreferences[conversationId]
    return {
      chatMode: preference?.chatMode ?? conversation.chatMode,
      conversationId,
      model: preference
        ? {
            label: preference.label,
            modelId: preference.modelId,
            providerId: preference.providerId,
            ...(preference.reasoningEffort ? { reasoningEffort: preference.reasoningEffort } : {}),
          }
        : null,
      updatedAt: conversation.updatedAt,
    }
  }

  private async updateConversationRuntime(input: UpdateConversationRuntimeInput): Promise<SharedConversationRuntimeSnapshot> {
    const conversationId = input.conversationId.trim()
    if (!conversationId) throw new Error('A conversation ID is required to update shared runtime state.')

    const previous = await this.getConversationRuntime(conversationId)
    const conversation = await getStoredConversation(conversationId).catch(() => null)
    const chatMode = input.chatMode ?? previous?.chatMode ?? conversation?.chatMode ?? 'agent'
    const model = input.model ?? previous?.model ?? null

    if (conversation && input.chatMode) {
      await updateStoredConversationChatMode(conversationId, input.chatMode)
    }

    if (conversation && model && (input.model || input.chatMode)) {
      const settings = await getStoredSettings()
      const existingPreference = settings.conversationModelPreferences[conversationId]
      await updateStoredConversationModelPreference(conversationId, {
        chatMode,
        label: model.label,
        modelId: model.modelId,
        providerId: model.providerId,
        ...(model.reasoningEffort ?? existingPreference?.reasoningEffort
          ? { reasoningEffort: model.reasoningEffort ?? existingPreference?.reasoningEffort }
          : {}),
      })
    }

    const runtime: SharedConversationRuntimeSnapshot = {
      chatMode,
      conversationId,
      model,
      updatedAt: Date.now(),
    }
    this.runtimeByConversationId.set(conversationId, runtime)
    this.emitGlobalEvent({
      type: 'conversation_runtime_updated',
      seq: 0,
      conversationId,
      runtime,
    })
    return runtime
  }

  private async compactConversation(input: CompactConversationInput): Promise<CompactConversationResult> {
    const conversationId = input.conversationId.trim()
    const [conversation, compactionMarkers] = await Promise.all([
      getStoredConversation(conversationId),
      listCompactionMarkers(conversationId),
    ])
    if (!hasMinimumCompactionMessages(conversation?.messages ?? input.messages, compactionMarkers)) {
      throw new Error(`At least ${MIN_COMPACTION_MESSAGE_COUNT} conversation messages are required since the latest compaction boundary before compacting.`)
    }
    const existingState = this.compactionStateByConversationId.get(conversationId)
    if (existingState?.phase === 'compacting') {
      throw new Error('Conversation compaction is already in progress.')
    }

    const attemptId = randomUUID()
    const streamId = randomUUID()
    this.compactionStateByConversationId.set(conversationId, { attemptId, phase: 'compacting', streamId })
    this.emitGlobalEvent({
      type: 'compaction_event',
      seq: 0,
      conversationId,
      event: { attemptId, conversationId, streamId, type: 'compaction_started' },
    })

    try {
      const result = input.providerId === 'codex'
        ? await compactCodexConversation(input)
        : await compactApiKeyConversation(input)
      if (!result.compacted || !result.packetId) {
        this.compactionStateByConversationId.delete(conversationId)
        this.emitGlobalEvent({
          type: 'compaction_event',
          seq: 0,
          conversationId,
          event: { attemptId, conversationId, reason: 'unavailable', streamId, type: 'compaction_failed' },
        })
        return result
      }

      this.compactionStateByConversationId.set(conversationId, {
        attemptId,
        compactionId: result.packetId,
        phase: 'compacted',
        streamId,
      })
      this.emitGlobalEvent({
        type: 'compaction_event',
        seq: 0,
        conversationId,
        event: { compactionId: result.packetId, conversationId, streamId, type: 'compaction_committed' },
      })
      return result
    } catch (error) {
      this.compactionStateByConversationId.delete(conversationId)
      this.emitGlobalEvent({
        type: 'compaction_event',
        seq: 0,
        conversationId,
        event: { attemptId, conversationId, reason: 'error', streamId, type: 'compaction_failed' },
      })
      throw error
    }
  }

  private async startSharedStream(input: StartChatStreamInput) {
    const conversationId = input.conversationId?.trim()
    if (!conversationId) {
      throw new Error('A saved conversation is required before starting a shared Tidecode run.')
    }
    const sharedInput: StartChatStreamInput & { conversationId: string } = { ...input, conversationId }
    const createdRun = this.registry.create(sharedInput)
    this.emitRunState(createdRun.runId)
    const existingConversation = await getStoredConversation(conversationId).catch(() => null)
    if (existingConversation) {
      this.emitEvent(createdRun.runId, {
        type: 'conversation_updated',
        runId: createdRun.runId,
        conversationId,
        conversation: existingConversation,
        seq: 0,
      })
    }

    const baseMessageCount = sharedInput.messages.length
    const projection: SharedRunProjection = {
      baseMessageCount,
      conversationId,
      revision: 0,
      isStreamingTextActive: false,
      messages: [],
      runId: createdRun.runId,
      streamingAssistantMessageId: null,
      streamingWaitingIndicatorVariant: null,
    }
    this.projectionsByRunId.set(createdRun.runId, projection)
    let projectionEmitScheduled = false
    const emitProjection = () => {
      if (projectionEmitScheduled) return
      projectionEmitScheduled = true
      queueMicrotask(() => {
        projectionEmitScheduled = false
        projection.revision += 1
        this.emitEvent(createdRun.runId, {
          type: 'run_projection',
          projection: {
            ...projection,
            messages: [...projection.messages],
          },
          seq: 0,
        })
      })
    }
    const stopProjectionTextStreaming = () => {
      const timeout = this.projectionTextIdleTimers.get(createdRun.runId)
      if (timeout) clearTimeout(timeout)
      this.projectionTextIdleTimers.delete(createdRun.runId)
      if (!projection.isStreamingTextActive) return
      projection.isStreamingTextActive = false
      emitProjection()
    }
    const pulseProjectionTextStreaming = () => {
      const timeout = this.projectionTextIdleTimers.get(createdRun.runId)
      if (timeout) clearTimeout(timeout)
      projection.isStreamingTextActive = true
      emitProjection()
      const nextTimeout = setTimeout(() => {
        this.projectionTextIdleTimers.delete(createdRun.runId)
        if (!projection.isStreamingTextActive) return
        projection.isStreamingTextActive = false
        emitProjection()
      }, TEXT_STREAM_IDLE_GRACE_MS)
      nextTimeout.unref?.()
      this.projectionTextIdleTimers.set(createdRun.runId, nextTimeout)
    }

    let latestSnapshot = [...input.messages]
    const persistence = new SharedStreamPersistence({
      chatMode: sharedInput.chatMode,
      conversationId,
      getChatMode: () => this.runtimeByConversationId.get(conversationId)?.chatMode ?? sharedInput.chatMode,
      onError: (error) => console.error('[run-service] Failed to persist stream progress.', error),
      onPersisted: (conversation) => {
        this.emitEvent(createdRun.runId, {
          type: 'conversation_updated',
          runId: createdRun.runId,
          conversationId,
          conversation,
          seq: 0,
        })
      },
    })
    const collector = new CliTurnMessageCollector(toCollectorState(sharedInput), {
      onConversationMessagesUpdated: (messages, options, hint) => {
        latestSnapshot = messages
        persistence.queue(messages, options, hint)
      },
      onConversationRuntimeStateUpdated: (runtimePatch) => {
        if (runtimePatch.streamingAssistantMessageId !== undefined) {
          projection.streamingAssistantMessageId = runtimePatch.streamingAssistantMessageId
        }
        if (runtimePatch.streamingWaitingIndicatorVariant !== undefined) {
          projection.streamingWaitingIndicatorVariant = runtimePatch.streamingWaitingIndicatorVariant
        }
        emitProjection()
      },
      onProjectionUpdated: (messages) => {
        projection.messages = messages.slice(baseMessageCount)
        emitProjection()
      },
      onTextStreamingPulse: pulseProjectionTextStreaming,
      onTextStreamingStopped: stopProjectionTextStreaming,
    })

    let terminalStatus: SharedRunStatus | null = null
    const target: ChatStreamEventTarget = {
      isDestroyed: () => false,
      emit: (event) => {
        collector.handleEvent(event)
        latestSnapshot = latestSnapshot.length > 0 ? latestSnapshot : [...input.messages]

        if (event.type === 'context_usage_updated') {
          this.registry.updateContextUsage(createdRun.runId, event.usage)
        }

        if (event.type === 'tool_invocation_decision_requested') {
          this.registry.updateStatus(createdRun.runId, 'waiting_for_input')
          this.emitRunState(createdRun.runId)
        } else if (
          this.registry.getByRunId(createdRun.runId)?.status === 'waiting_for_input'

        ) {
          this.registry.updateStatus(createdRun.runId, 'running')
          this.emitRunState(createdRun.runId)
        }

        this.emitEvent(createdRun.runId, {
          type: 'chat_event',
          runId: createdRun.runId,
          conversationId,
          event,
          seq: 0,
        })

        if (event.type === 'steer_messages_consumed') {
          const snapshot = this.followUps.consume(event.streamId, event.messages.map((message) => message.id))
          if (snapshot) {
            this.syncProviderSteers(snapshot)
            this.emitFollowUps(snapshot)
          }
        }

        const nextTerminalStatus = terminalStatusForEvent(event)
        if (nextTerminalStatus) terminalStatus = nextTerminalStatus
      },
    }

    const settleRun = async () => {
      const finalizedMessages = collector.finalize()
      projection.messages = [...finalizedMessages]
      projection.isStreamingTextActive = false
      projection.streamingAssistantMessageId = null
      projection.streamingWaitingIndicatorVariant = null
      emitProjection()
      latestSnapshot = finalizedMessages.length > 0 ? [...sharedInput.messages, ...finalizedMessages] : latestSnapshot
      const shouldPersistFinalSnapshot = !(terminalStatus === 'cancelled' && finalizedMessages.length === 0)
      if (shouldPersistFinalSnapshot) {
        persistence.queue(latestSnapshot, { immediate: true })
      }
      await persistence.flush()

      const current = this.registry.getByRunId(createdRun.runId)
      if (!current) return
      const status = terminalStatus ?? (current.status === 'cancelled' ? 'cancelled' : 'completed')
      this.registry.updateStatus(createdRun.runId, status)
      this.emitRunState(createdRun.runId)
      stopProjectionTextStreaming()
      const retentionTimer = setTimeout(() => {
        const retainedRun = this.registry.getByRunId(createdRun.runId)
        if (retainedRun?.streamId) this.followUps.remove(retainedRun.streamId)
        this.registry.remove(createdRun.runId)
        this.projectionsByRunId.delete(createdRun.runId)
        const textIdleTimer = this.projectionTextIdleTimers.get(createdRun.runId)
        if (textIdleTimer) clearTimeout(textIdleTimer)
        this.projectionTextIdleTimers.delete(createdRun.runId)
      }, TERMINAL_RUN_RETENTION_MS)
      retentionTimer.unref?.()
    }

    const result = input.providerId === 'codex'
      ? await startCodexChatStream(target, sharedInput, () => { void settleRun() })
      : await startApiKeyChatStream(target, sharedInput, () => { void settleRun() })

    this.registry.attachStream(createdRun.runId, result.streamId)
    const followUpSnapshot = this.followUps.register(createdRun.runId, result.streamId, conversationId)
    this.emitRunState(createdRun.runId)
    this.emitFollowUps(followUpSnapshot)
    return result
  }

  private syncProviderSteers(snapshot: SharedFollowUpSnapshot) {
    const input = {
      messages: snapshot.items.filter((item) => item.behavior === 'steer').map((item) => item.message),
      revision: snapshot.revision,
      streamId: snapshot.streamId,
    }
    const providerId = this.registry.getProviderByStreamId(snapshot.streamId)
    if (providerId === 'codex') updateCodexPendingSteerMessages(input)
    else if (providerId) updateApiKeyPendingSteerMessages(input)
  }

  private emitFollowUps(snapshot: SharedFollowUpSnapshot) {
    this.emitEvent(snapshot.runId, { type: 'follow_ups_updated', seq: 0, snapshot })
  }

  private nextSeq(runId: string) {
    const next = (this.nextSeqByRunId.get(runId) ?? 0) + 1
    this.nextSeqByRunId.set(runId, next)
    this.registry.setLastEventSeq(runId, next)
    return next
  }

  private emitRunState(runId: string) {
    const run = this.registry.getByRunId(runId)
    if (!run) return
    this.emitEvent(runId, { type: 'run_state', run, seq: 0 })
  }

  private emitEvent(runId: string, event: TideCodeRunEvent) {
    const seq = this.nextSeq(runId)
    const normalizedEvent = event.type === 'run_state'
      ? { ...event, run: this.registry.getByRunId(runId) ?? event.run }
      : event
    const withSeq = { ...normalizedEvent, seq } as TideCodeRunEvent
    const payload = `${JSON.stringify({ type: 'event', event: withSeq })}\n`
    for (const client of this.clients) {
      if (!client.destroyed) client.write(payload)
    }
  }

  private emitConversationAppend(conversation: ConversationRecord) {
    this.emitConversationMutation('conversation_appended', conversation)
  }

  private emitConversationReplacement(conversation: ConversationRecord) {
    this.emitConversationMutation('conversation_replaced', conversation)
  }

  private emitConversationMutation(
    type: 'conversation_appended' | 'conversation_replaced',
    conversation: ConversationRecord,
  ) {
    this.emitGlobalEvent({
      type,
      seq: 0,
      conversationId: conversation.id,
      conversation,
    })
  }

  private emitGlobalEvent(event: TideCodeRunEvent) {
    const withSeq = { ...event, seq: ++this.nextConversationEventSeq } as TideCodeRunEvent
    const payload = `${JSON.stringify({ type: 'event', event: withSeq })}\n`
    for (const client of this.clients) {
      if (!client.destroyed) client.write(payload)
    }
  }

  private sendResponse(socket: Socket, response: RunServiceResponse) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
  }
}
