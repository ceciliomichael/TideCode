import type { ChatAttachment, ChatStreamEvent, QueuedMessage, StartChatStreamInput } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { getStoredConversation } from '../history/store'
import { ensureRunServiceClient } from '../runService/ensureService'
import { createTerminalChatEventSink } from './events'
import { expandMentionsIntoContext } from './mentions'
import { createAndPersistCliUserMessage } from './cliHistory'
import { CliTurnFollowUpController } from './cliTurnFollowUps'
import { isSharedRunTerminalStatus, watchSharedRunSettlement } from './sharedRunReconciliation'
import type { CliSessionState } from './types'
import type { TerminalPromptContext, TerminalPromptSubmission, TerminalScreen } from './terminalScreen'

export interface ReplTurnResult {
  nextInput: Promise<TerminalPromptSubmission>
  queuedInputs: QueuedMessage[]
}

export interface ReplTurnOptions {
  attachments?: readonly ChatAttachment[]
  printUserMessage?: boolean
  userMessageLeadingSpacer?: boolean
}

export async function runReplTurn(
  input: string,
  state: CliSessionState,
  screen: TerminalScreen,
  nextPromptContext: TerminalPromptContext,
  options: ReplTurnOptions = {},
): Promise<ReplTurnResult> {
  const attachments = options.attachments ?? []
  const { expandedText } = await expandMentionsIntoContext(input, state.workspaceRootPath)
  const userMessage = await createAndPersistCliUserMessage(state, input, attachments)
  const runtimeMessages = state.messages.map((message) => (
    message.id === userMessage.id
      ? { ...message, content: expandedText, attachments: attachments.length > 0 ? [...attachments] : undefined }
      : message
  ))
  screen.addUserMessage(input, options.printUserMessage === true, {
    leadingSpacer: options.userMessageLeadingSpacer,
  })
  screen.beginTurn(nextPromptContext.onCancelTurn)
  let followUpController: CliTurnFollowUpController | null = null
  let queuedInputs: QueuedMessage[] = []
  let settleSharedRun: () => void = () => undefined
  const sharedRunSettled = new Promise<void>((resolve) => {
    settleSharedRun = resolve
  })

  state.isStreaming = true
  let nextInput: Promise<TerminalPromptSubmission> | null = null
  let settleTurn: () => void = () => undefined
  let turnPresentationSettled = false
  const turnSettled = new Promise<void>((resolve) => {
    settleTurn = resolve
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
    onComplete: () => {
      turnPresentationSettled = true
      state.isStreaming = false
      settleTurn()
    },
    onError: (error) => {
      turnPresentationSettled = true
      state.isStreaming = false
      screen.addNotice('error', `Turn failed: ${error}`)
      settleTurn()
    },
  })

  const streamInput: StartChatStreamInput = {
    agentContextRootPath: state.workspaceRootPath,
    chatMode: state.chatMode,
    contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
    conversationId: state.conversationId,
    messages: runtimeMessages,
    modelId: state.modelId,
    providerId: state.providerId,
    reasoningEffort: state.reasoningEffort,
    terminalExecutionMode: state.terminalExecutionMode,
  }

  const queuedEvents: ChatStreamEvent[] = []
  let streamId: string | null = null
  let unsubscribeRunEvents: (() => void) | null = null
  let stopRunReconciliation: (() => void) | null = null

  const deliverEvent = (event: ChatStreamEvent) => {
    if (typeof sink.emit === 'function') sink.emit(event)
    else sink.send?.('chat:stream:event', event)
  }

  try {
    const runService = await ensureRunServiceClient()
    unsubscribeRunEvents = runService.onEvent((event) => {
      if (event.type === 'follow_ups_updated') {
        if (streamId && event.snapshot.streamId === streamId) {
          followUpController?.applySnapshot(event.snapshot)
          screen.setActiveFollowUps(event.snapshot.items.map((item) => ({
            behavior: item.behavior,
            text: item.message.content,
          })))
        }
        return
      }
      if (event.type === 'run_state') {
        if (streamId && event.run.streamId === streamId && isSharedRunTerminalStatus(event.run.status)) {
          settleSharedRun()
        }
        return
      }
      if (event.type !== 'chat_event' || event.conversationId !== state.conversationId) return
      if (!streamId) {
        queuedEvents.push(event.event)
        return
      }
      if (event.event.streamId === streamId) deliverEvent(event.event)
    })

    const streamResult = await runService.startStream(streamInput)
    streamId = streamResult.streamId
    state.activeStreamId = streamResult.streamId
    stopRunReconciliation = watchSharedRunSettlement(runService, streamResult.streamId, {
      onMissing: () => {
        if (!turnPresentationSettled) {
          turnPresentationSettled = true
          screen.finishTurn()
          settleTurn()
        }
        settleSharedRun()
      },
      onTerminal: () => {
        if (!turnPresentationSettled) {
          turnPresentationSettled = true
          screen.finishTurn()
          settleTurn()
        }
        settleSharedRun()
      },
    })
    followUpController = new CliTurnFollowUpController(state.providerId, streamResult.streamId)
    const initialFollowUps = await runService.getPendingFollowUps(streamResult.streamId).catch(() => null)
    if (initialFollowUps) {
      followUpController.applySnapshot(initialFollowUps)
      screen.setActiveFollowUps(initialFollowUps.items.map((item) => ({
        behavior: item.behavior,
        text: item.message.content,
      })))
    }

    for (const event of queuedEvents.splice(0)) {
      if (event.streamId === streamResult.streamId) deliverEvent(event)
    }

    nextInput = screen.ask({
      ...nextPromptContext,
      onActiveMessage: (text, behavior) => {
        followUpController?.add(text, behavior)
      },
    })
    await turnSettled
    await sharedRunSettled
    queuedInputs = await followUpController.claimQueuedTurnMessages()

    const conversation = await getStoredConversation(state.conversationId).catch(() => null)
    if (conversation) state.messages = [...conversation.messages]
  } catch (error) {
    state.isStreaming = false
    screen.finishTurn()
    screen.addNotice('error', `Could not start the turn: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    stopRunReconciliation?.()
    unsubscribeRunEvents?.()
    state.isStreaming = false
    state.activeStreamId = null
  }

  return {
    nextInput: nextInput ?? screen.ask(nextPromptContext),
    queuedInputs,
  }
}
