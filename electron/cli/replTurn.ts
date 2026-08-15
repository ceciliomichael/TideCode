import type { StartChatStreamInput } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { startApiKeyChatStream } from '../chat/apiKey/runtime'
import { startCodexChatStream } from '../chat/codex/runtime'
import { createTerminalChatEventSink } from './events'
import { expandMentionsIntoContext } from './mentions'
import { createAndPersistCliUserMessage, persistCliAssistantMessages } from './cliHistory'
import { CliTurnMessageCollector } from './cliTurnMessageCollector'
import { CliTurnFollowUpController } from './cliTurnFollowUps'
import type { CliSessionState } from './types'
import type { TerminalPromptContext, TerminalScreen } from './terminalScreen'

export interface ReplTurnResult {
  nextInput: Promise<string>
  queuedInputs: string[]
}

export interface ReplTurnOptions {
  printUserMessage?: boolean
}

export async function runReplTurn(
  input: string,
  state: CliSessionState,
  screen: TerminalScreen,
  nextPromptContext: TerminalPromptContext,
  options: ReplTurnOptions = {},
): Promise<ReplTurnResult> {
  const { expandedText } = await expandMentionsIntoContext(input, state.workspaceRootPath)
  const userMessage = await createAndPersistCliUserMessage(state, input)
  const runtimeMessages = state.messages.map((message) => (
    message.id === userMessage.id ? { ...message, content: expandedText } : message
  ))
  screen.addUserMessage(input, options.printUserMessage === true)
  screen.beginTurn()
  const messageCollector = new CliTurnMessageCollector(state)
  let followUpController: CliTurnFollowUpController | null = null

  state.isStreaming = true
  let nextInput: Promise<string> | null = null
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
      messageCollector.handleEvent(event)
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

  try {
    const streamResult = state.providerId === 'codex'
      ? await startCodexChatStream(sink, streamInput)
      : await startApiKeyChatStream(sink, streamInput)
    state.activeStreamId = streamResult.streamId
    followUpController = new CliTurnFollowUpController(state.providerId, streamResult.streamId)
    nextInput = screen.ask({
      ...nextPromptContext,
      onActiveMessage: (text, behavior) => {
        followUpController?.add(text, behavior)
      },
    })
    await turnSettled

    try {
      await persistCliAssistantMessages(state, messageCollector.finalize())
    } catch (error) {
      screen.addNotice('error', `Could not save the completed turn: ${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    state.isStreaming = false
    screen.finishTurn()
    screen.addNotice('error', `Could not start the turn: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.isStreaming = false
    state.activeStreamId = null
  }

  return {
    nextInput: nextInput ?? screen.ask(nextPromptContext),
    queuedInputs: followUpController?.getQueuedTurnInputs() ?? [],
  }
}
