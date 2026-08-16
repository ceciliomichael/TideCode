import type { ChatStreamEvent } from '../../src/types/chat'
import { getStoredConversation } from '../history/store'
import { ensureRunServiceClient } from '../runService/ensureService'
import { createTerminalChatEventSink } from './events'
import type { CliSessionState } from './types'
import type { TerminalScreen } from './terminalScreen'

function isTerminalStatus(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

export async function attachCliToActiveSharedRun(
  state: CliSessionState,
  screen: TerminalScreen,
): Promise<boolean> {
  const runService = await ensureRunServiceClient()
  let streamId: string | null = null
  let runId: string | null = null
  let presentationReady = false
  let runEnded = false
  const queuedEvents: ChatStreamEvent[] = []
  let settle: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })

  const { sink } = createTerminalChatEventSink({
    mode: state.chatMode,
    modelId: state.modelId,
    providerId: state.providerId,
    workspaceRootPath: state.workspaceRootPath,
    presentation: screen.eventPresentation,
    onError: (error) => screen.addNotice('error', `Shared run failed: ${error}`),
  })
  const deliverEvent = (event: ChatStreamEvent) => {
    if (typeof sink.emit === 'function') sink.emit(event)
    else sink.send?.('chat:stream:event', event)
  }
  const flushQueuedEvents = () => {
    if (!presentationReady || !streamId) return
    for (const queuedEvent of queuedEvents.splice(0)) {
      if (queuedEvent.streamId === streamId) deliverEvent(queuedEvent)
    }
  }

  const unsubscribe = runService.onEvent((event) => {
    if (event.type === 'run_state' && event.run.conversationId === state.conversationId) {
      if (!runId) runId = event.run.runId
      if (event.run.runId !== runId) return
      if (event.run.streamId) {
        streamId = event.run.streamId
        state.activeStreamId = event.run.streamId
        flushQueuedEvents()
      }
      if (isTerminalStatus(event.run.status)) {
        runEnded = true
        settle()
      }
      return
    }

    if (event.type !== 'chat_event' || event.conversationId !== state.conversationId) return
    if (!streamId || !presentationReady) {
      queuedEvents.push(event.event)
      return
    }
    if (event.event.streamId === streamId) deliverEvent(event.event)
  })

  try {
    const activeRun = (await runService.listActiveRuns()).find((run) => run.conversationId === state.conversationId)
    if (!activeRun) return false

    runId = activeRun.runId
    streamId = activeRun.streamId
    state.activeStreamId = activeRun.streamId
    state.isStreaming = true

    const latestConversation = await getStoredConversation(state.conversationId).catch(() => null)
    if (latestConversation) {
      state.messages = [...latestConversation.messages]
      screen.restoreConversation(latestConversation.messages, {
        mode: state.chatMode,
        model: state.modelId,
        provider: state.providerId,
        workspace: state.workspaceRootPath,
      }, true)
    }

    if (runEnded) {
      await settled
      const finalConversation = await getStoredConversation(state.conversationId).catch(() => null)
      if (finalConversation) {
        state.messages = [...finalConversation.messages]
        screen.restoreConversation(finalConversation.messages, {
          mode: state.chatMode,
          model: state.modelId,
          provider: state.providerId,
          workspace: state.workspaceRootPath,
        }, true)
      }
      return true
    }

    screen.beginTurn(() => {
      if (!streamId) return
      screen.setActivity('thinking', 'Stopping')
      void runService.cancelStream(streamId).catch((error) => {
        screen.addNotice('error', `Could not stop the turn: ${error instanceof Error ? error.message : String(error)}`)
      })
    }, {
      // restoreConversation already leaves one blank transcript row after the
      // latest user message. Reuse it instead of adding a second spacer when a
      // Desktop-started run is attached live in the CLI.
      leadingSpacer: !(latestConversation?.messages.length),
    })
    presentationReady = true
    flushQueuedEvents()

    await settled
    // A provider should emit a terminal chat event, but the run-state event is
    // authoritative. Finish idempotently here as a fallback so cancellation or
    // an interrupted provider can never leave a zombie active composer behind.
    screen.finishTurn()
    const finalConversation = await getStoredConversation(state.conversationId).catch(() => null)
    if (finalConversation) state.messages = [...finalConversation.messages]
    return true
  } finally {
    unsubscribe()
    state.isStreaming = false
    state.activeStreamId = null
  }
}
