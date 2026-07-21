import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  CompressChatHistoryInput,
  ContextUsageEstimate,
  EstimateContextUsageInput,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from '../../../src/types/chat'
import { compressChatHistory } from '../shared/compression'
import { estimateToolEnabledContextUsage, runToolEnabledChatStream } from '../shared/runtime'
import { createApiKeyChatClient } from './client'
import { readApiKeyChatProviderConfig } from './config'

const activeStreams = new Map<string, AbortController>()

export async function estimateApiKeyContextUsage(input: EstimateContextUsageInput): Promise<ContextUsageEstimate> {
  return estimateToolEnabledContextUsage({
    agentContextRootPath: input.agentContextRootPath,
    chatMode: input.chatMode,
    messages: input.messages,
  })
}

export async function compressApiKeyChatHistory(input: CompressChatHistoryInput): Promise<string> {
  if (input.providerId === 'codex') {
    throw new Error('Codex compression must use the Codex runtime.')
  }
  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error('Select a model before compressing a chat.')
  }

  const config = await readApiKeyChatProviderConfig(input.providerId)
  const client = createApiKeyChatClient(config)
  return compressChatHistory({
    agentContextRootPath: input.agentContextRootPath,
    chatMode: input.chatMode,
    createStream: (streamInput) =>
      client.chat.completions.create({
        messages: streamInput.messages,
        model: streamInput.model,
        reasoningEffort: streamInput.reasoningEffort,
        signal: streamInput.signal,
        system: streamInput.system,
      }),
    messages: input.messages,
    modelId,
    reasoningEffort: input.reasoningEffort,
  })
}

export async function startApiKeyChatStream(
  webContents: WebContents,
  input: StartChatStreamInput,
  onSettled?: () => void,
): Promise<StartChatStreamResult> {
  if (input.providerId === 'codex') {
    throw new Error('Codex streams must use the Codex runtime.')
  }
  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error('Select a model before starting a chat.')
  }

  const streamId = randomUUID()
  const abortController = new AbortController()
  activeStreams.set(streamId, abortController)

  queueMicrotask(() => {
    void runApiKeyChatStream(webContents, streamId, input, abortController, onSettled)
  })
  return { streamId }
}

async function runApiKeyChatStream(
  webContents: WebContents,
  streamId: string,
  input: StartChatStreamInput,
  abortController: AbortController,
  onSettled?: () => void,
) {
  try {
    if (input.providerId === 'codex') {
      throw new Error('Codex streams must use the Codex runtime.')
    }
    const config = await readApiKeyChatProviderConfig(input.providerId)
    const client = createApiKeyChatClient(config)
    await runToolEnabledChatStream({
      abortController,
      createStream: (streamInput) =>
        client.chat.completions.create({
          messages: streamInput.messages,
          model: streamInput.model,
          reasoningEffort: streamInput.reasoningEffort,
          signal: streamInput.signal,
          stopWhen: streamInput.stopWhen,
          system: streamInput.system,
          tools: streamInput.tools,
        }),
      onSettled,
      promptOptions: { includeAssistantReasoningParts: input.providerId === 'openai' },
      startInput: input,
      streamId,
      webContents,
    })
  } finally {
    activeStreams.delete(streamId)
  }
}

export async function cancelApiKeyChatStream(streamId: string) {
  activeStreams.get(streamId)?.abort()
}

export async function submitApiKeyToolDecision(
  input: SubmitToolDecisionInput,
): Promise<SubmitToolDecisionResult> {
  void input
  throw new Error('Tool decisions are not implemented for API-key providers yet.')
}
