import type { ChatAttachment, ChatStreamEvent, StartChatStreamInput } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { getStoredConversation } from '../history/store'
import { ensureRunServiceClient } from '../runService/ensureService'
import { createTerminalChatEventSink } from './events'
import { expandMentionsIntoContext } from './mentions'
import { createAndPersistCliUserMessage } from './cliHistory'
import { CliTurnFollowUpController } from './cliTurnFollowUps'
import type { CliSessionState } from './types'
import type { TerminalPromptContext, TerminalPromptSubmission, TerminalScreen } from './terminalScreen'

export interface ReplTurnResult {
  nextInput: Promise<TerminalPromptSubmission>
  queuedInputs: string[]
}

export interface ReplTurnOptions {
  attachments?: readonly ChatAttachment[]
  printUserMessage?: boolean
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
  screen.addUserMessage(input, options.printUserMessage === true)
  screen.beginTurn(nextPromptContext.onCancelTurn)
  let followUpController: CliTurnFollowUpController | null = null

  state.isStreaming = true
  let nextInput: Promise<TerminalPromptSubmission> | null = null
  let settleTurn: () => void = () => undefined
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
      if (event.type === 'steer_messages_consumed') followUpController?.markConsumed(event.messages)
    },
    onComplete: () => {
      state.isStreaming = false
      settleTurn()
    },
    onError: (error) => {
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

  const deliverEvent = (event: ChatStreamEvent) => {
    if (typeof sink.emit === 'function') sink.emit(event)
    else sink.send?.('chat:stream:event', event)
  }

  try {
    const runService = await ensureRunServiceClient()
    unsubscribeRunEvents = runService.onEvent((event) => {
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
    followUpController = new CliTurnFollowUpController(state.providerId, streamResult.streamId)

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

    const conversation = await getStoredConversation(state.conversationId).catch(() => null)
    if (conversation) state.messages = [...conversation.messages]
  } catch (error) {
    state.isStreaming = false
    screen.finishTurn()
    screen.addNotice('error', `Could not start the turn: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    unsubscribeRunEvents?.()
    state.isStreaming = false
    state.activeStreamId = null
  }

  return {
    nextInput: nextInput ?? screen.ask(nextPromptContext),
    queuedInputs: followUpController?.getQueuedTurnInputs() ?? [],
  }
}
