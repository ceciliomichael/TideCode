import type { StartChatStreamInput } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import type { CliOptions, CliSessionState } from './types'
import { expandMentionsIntoContext } from './mentions'
import { createTerminalChatEventSink } from './events'
import { startApiKeyChatStream } from '../chat/apiKey/runtime'
import { startCodexChatStream } from '../chat/codex/runtime'
import { colors } from './renderer'
import { createAndPersistCliUserMessage, persistCliAssistantMessages } from './cliHistory'
import { CliTurnMessageCollector } from './cliTurnMessageCollector'

export async function runHeadlessPrompt(
  prompt: string,
  state: CliSessionState,
  _options: CliOptions = {},
): Promise<number> {
  void _options
  // Check for piped stdin if available without a prompt
  let fullPrompt = prompt
  if (!process.stdin.isTTY && !prompt) {
    let pipedData = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
      pipedData += chunk
    }
    if (pipedData.trim()) {
      fullPrompt = pipedData.trim()
    }
  }

  // Statically resolve and expand @ mentions
  const { expandedText } = await expandMentionsIntoContext(fullPrompt, state.workspaceRootPath)

  const userMessage = await createAndPersistCliUserMessage(state, fullPrompt)
  const runtimeMessages = state.messages.map((message) => (
    message.id === userMessage.id ? { ...message, content: expandedText } : message
  ))
  const messageCollector = new CliTurnMessageCollector(state)

  return new Promise((resolve) => {
    let hasError = false
    let hasSettled = false

    const settle = async (exitCode: number) => {
      if (hasSettled) return
      hasSettled = true
      await persistCliAssistantMessages(state, messageCollector.finalize())
      resolve(exitCode)
    }

    const { sink } = createTerminalChatEventSink({
      onEvent: (event) => messageCollector.handleEvent(event),
      onComplete: () => {
        void settle(hasError ? 1 : 0)
      },
      onError: (errMsg) => {
        hasError = true
        console.error(`\n${colors.red}Error: ${errMsg}${colors.reset}`)
        void settle(1)
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

    if (state.providerId === 'codex') {
      startCodexChatStream(sink, streamInput).catch((err) => {
        console.error(`\n${colors.red}Failed to start Codex stream: ${err instanceof Error ? err.message : String(err)}${colors.reset}`)
        void settle(1)
      })
    } else {
      startApiKeyChatStream(sink, streamInput).catch((err) => {
        console.error(`\n${colors.red}Failed to start chat stream: ${err instanceof Error ? err.message : String(err)}${colors.reset}`)
        void settle(1)
      })
    }
  })
}
