import type { ChatStreamEvent, StartChatStreamInput } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { getStoredConversation } from '../history/store'
import { ensureRunServiceClient } from '../runService/ensureService'
import type { CliOptions, CliSessionState } from './types'
import { expandMentionsIntoContext } from './mentions'
import { createTerminalChatEventSink } from './events'
import { colors } from './renderer'
import { createAndPersistCliUserMessage } from './cliHistory'

export async function runHeadlessPrompt(
  prompt: string,
  state: CliSessionState,
  _options: CliOptions = {},
): Promise<number> {
  void _options
  const fullPrompt = prompt.trim()
  if (!fullPrompt) {
    console.error(`${colors.red}A non-empty prompt is required for headless mode.${colors.reset}`)
    return 1
  }

  const { expandedText } = await expandMentionsIntoContext(fullPrompt, state.workspaceRootPath)
  const userMessage = await createAndPersistCliUserMessage(state, fullPrompt)
  const runtimeMessages = state.messages.map((message) => (
    message.id === userMessage.id ? { ...message, content: expandedText } : message
  ))

  return new Promise((resolve) => {
    let hasSettled = false
    let streamId: string | null = null
    let unsubscribe: (() => void) | null = null
    const queuedEvents: ChatStreamEvent[] = []

    const settle = async (exitCode: number) => {
      if (hasSettled) return
      hasSettled = true
      unsubscribe?.()
      const conversation = await getStoredConversation(state.conversationId).catch(() => null)
      if (conversation) state.messages = [...conversation.messages]
      resolve(exitCode)
    }

    const { sink } = createTerminalChatEventSink({
      onComplete: () => { void settle(0) },
      onError: (errMsg) => {
        console.error(`\n${colors.red}Error: ${errMsg}${colors.reset}`)
        void settle(1)
      },
    })
    const deliverEvent = (event: ChatStreamEvent) => {
      if (typeof sink.emit === 'function') sink.emit(event)
      else sink.send?.('chat:stream:event', event)
    }

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

    void ensureRunServiceClient()
      .then((runService) => {
        unsubscribe = runService.onEvent((event) => {
          if (event.type !== 'chat_event' || event.conversationId !== state.conversationId) return
          if (!streamId) {
            queuedEvents.push(event.event)
            return
          }
          if (event.event.streamId === streamId) deliverEvent(event.event)
        })
        return runService.startStream(streamInput)
      })
      .then((result) => {
        streamId = result.streamId
        state.activeStreamId = result.streamId
        for (const event of queuedEvents.splice(0)) {
          if (event.streamId === result.streamId) deliverEvent(event)
        }
      })
      .catch((error) => {
        console.error(`\n${colors.red}Failed to start shared chat stream: ${error instanceof Error ? error.message : String(error)}${colors.reset}`)
        void settle(1)
      })
  })
}
