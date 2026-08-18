import type { ChatStreamEvent, QueuedMessage, SharedFollowUpSnapshot } from '../../src/types/chat'
import { getStoredConversation } from '../history/store'
import { ensureRunServiceClient } from '../runService/ensureService'
import { CliTurnFollowUpController } from './cliTurnFollowUps'
import { createTerminalChatEventSink } from './events'
import type { CliSessionState } from './types'
import type { TerminalScreen } from './terminalScreen'

function isTerminalStatus(status: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

interface SharedRunAttachmentOptions {
  ensurePrompt?: () => void
  onClaimedFollowUps?: (messages: QueuedMessage[]) => void
}

export async function attachCliToActiveSharedRun(
  state: CliSessionState,
  screen: TerminalScreen,
  options: SharedRunAttachmentOptions = {},
): Promise<boolean> {
  const runService = await ensureRunServiceClient()
  let streamId: string | null = null
  let runId: string | null = null
  let presentationReady = false
  let runEnded = false
  let followUpController: CliTurnFollowUpController | null = null
  let pendingFollowUpSnapshot: SharedFollowUpSnapshot | null = null
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
    onEvent: (event) => {
      if (event.type === 'steer_messages_consumed') {
        followUpController?.markConsumed(event.messages)
        screen.addConsumedUserMessages(event.messages)
      }
    },
    onError: (error) => screen.addNotice('error', 'Shared run failed: ' + error),
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
  const renderFollowUps = (snapshot: SharedFollowUpSnapshot) => {
    screen.setActiveFollowUps(snapshot.items.map((item) => ({
      behavior: item.behavior,
      text: item.message.content,
    })))
  }
  const attachFollowUpController = async () => {
    if (!streamId || followUpController) return
    options.ensurePrompt?.()
    followUpController = new CliTurnFollowUpController(state.providerId, streamId)
    screen.setPendingActiveMessageHandler((text, behavior) => {
      followUpController?.add(text, behavior)
    })
    const snapshot = pendingFollowUpSnapshot ?? await runService.getPendingFollowUps(streamId).catch(() => null)
    if (snapshot) {
      pendingFollowUpSnapshot = snapshot
      followUpController.applySnapshot(snapshot)
      renderFollowUps(snapshot)
    }
  }

  const claimQueuedFollowUps = async () => {
    const controller = followUpController as CliTurnFollowUpController | null
    return controller ? controller.claimQueuedTurnMessages() : []
  }

  const unsubscribe = runService.onEvent((event) => {
    if (event.type === 'follow_ups_updated') {
      if (runId && event.snapshot.runId !== runId) return
      pendingFollowUpSnapshot = event.snapshot
      followUpController?.applySnapshot(event.snapshot)
      if (presentationReady) renderFollowUps(event.snapshot)
      return
    }

    if (event.type === 'run_state' && event.run.conversationId === state.conversationId) {
      if (!runId) runId = event.run.runId
      if (event.run.runId !== runId) return
      if (event.run.streamId) {
        streamId = event.run.streamId
        state.activeStreamId = event.run.streamId
        void attachFollowUpController()
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
    await attachFollowUpController()

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
      const claimed = await claimQueuedFollowUps()
      if (claimed.length > 0) options.onClaimedFollowUps?.(claimed)
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
        screen.addNotice('error', 'Could not stop the turn: ' + (error instanceof Error ? error.message : String(error)))
      })
    }, {
      leadingSpacer: !(latestConversation?.messages.length),
    })
    presentationReady = true
    if (pendingFollowUpSnapshot) renderFollowUps(pendingFollowUpSnapshot)
    flushQueuedEvents()

    await settled
    const claimed = await claimQueuedFollowUps()
    if (claimed.length > 0) options.onClaimedFollowUps?.(claimed)
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
