import net from 'node:net'
import type { Socket } from 'node:net'
import type {
  ChatStreamEvent,
  SharedRunProjection,
  SharedRunStatus,
  StartChatStreamInput,
  TideCodeRunEvent,
} from '../../src/types/chat'
import {
  cancelApiKeyChatStream,
  startApiKeyChatStream,
  submitApiKeyToolDecision,
  updateApiKeyPendingSteerMessages,
} from '../chat/apiKey/runtime'
import {
  cancelCodexChatStream,
  startCodexChatStream,
  submitCodexToolDecision,
  updateCodexPendingSteerMessages,
} from '../chat/codex/runtime'
import type { ChatStreamEventTarget } from '../chat/shared/runtimeStreamEvents'
import { CliTurnMessageCollector } from '../cli/cliTurnMessageCollector'
import { getStoredConversation } from '../history/store'
import type { CliSessionState } from '../cli/types'
import { RUN_SERVICE_PROTOCOL_VERSION, isRunServiceRequest, type RunServiceResponse } from './protocol'
import { ensureRunServiceToken, getRunServiceEndpoint, removeStaleRunServiceSocket } from './paths'
import { SharedRunRegistry } from './runRegistry'
import { SharedStreamPersistence } from './streamPersistence'

const TERMINAL_RUN_RETENTION_MS = 60_000
const TEXT_STREAM_IDLE_GRACE_MS = 1_500

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
  private readonly nextSeqByRunId = new Map<string, number>()
  private readonly projectionsByRunId = new Map<string, SharedRunProjection>()
  private readonly projectionTextIdleTimers = new Map<string, NodeJS.Timeout>()
  private token = ''

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
            result: { protocolVersion: RUN_SERVICE_PROTOCOL_VERSION },
          })
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
        case 'submitToolDecision': {
          const providerId = this.registry.getProviderByStreamId(parsed.params.streamId)
          if (!providerId) throw new Error('Unable to determine which provider owns this shared run.')
          const result = providerId === 'codex'
            ? await submitCodexToolDecision(parsed.params)
            : await submitApiKeyToolDecision(parsed.params)
          this.sendResponse(socket, { id: parsed.id, ok: true, result })
          return
        }
      }
    } catch (error) {
      this.sendResponse(socket, { id: parsed.id, ok: false, error: toErrorMessage(error) })
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
      isStreamingTextActive: false,
      messages: [],
      runId: createdRun.runId,
      streamingAssistantMessageId: null,
      streamingWaitingIndicatorVariant: null,
    }
    this.projectionsByRunId.set(createdRun.runId, projection)
    const emitProjection = () => {
      this.emitEvent(createdRun.runId, {
        type: 'run_projection',
        projection: {
          ...projection,
          messages: [...projection.messages],
        },
        seq: 0,
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
    this.emitRunState(createdRun.runId)
    return result
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

  private sendResponse(socket: Socket, response: RunServiceResponse) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
  }
}
