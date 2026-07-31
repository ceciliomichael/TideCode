import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  CompressChatHistoryInput,
  CompactConversationInput,
  CompactConversationResult,
  ContextUsageEstimate,
  EstimateContextUsageInput,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from '../../../src/types/chat'
import { compressChatHistory } from '../shared/compression'
import { shouldReplayAssistantReasoning } from '../shared/assistantReasoningPolicy'
import { estimateToolEnabledContextUsage, runToolEnabledChatStream } from '../shared/runtime'
import { createApiKeyChatClient } from './client'
import { readApiKeyChatProviderConfig } from './config'
import { compactConversationForProvider } from '../shared/compaction/manual'

const activeStreams = new Map<string, AbortController>()

export async function estimateApiKeyContextUsage(
  webContents: WebContents,
  input: EstimateContextUsageInput,
): Promise<ContextUsageEstimate> {
  return estimateToolEnabledContextUsage({
    agentContextRootPath: input.agentContextRootPath,
    chatMode: input.chatMode,
    conversationId: input.conversationId,
    contextCompaction: input.contextCompaction,
    messages: input.messages,
    modelId: input.modelId,
    providerId: input.providerId,
    terminalExecutionMode: input.terminalExecutionMode,
    webContents,
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

export async function compactApiKeyConversation(input: CompactConversationInput): Promise<CompactConversationResult> {
  if (input.providerId === 'codex') {
    throw new Error('Codex compaction must use the Codex runtime.')
  }
  if (!input.conversationId.trim()) {
    throw new Error('A saved conversation is required before compacting it.')
  }

  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error('Select a model before compacting a chat.')
  }

  const config = await readApiKeyChatProviderConfig(input.providerId)
  const client = createApiKeyChatClient(config)
  const result = await compactConversationForProvider({
    agentContextRootPath: input.agentContextRootPath,
    chatMode: input.chatMode,
    conversationId: input.conversationId,
    contextCompaction: input.contextCompaction,
    createStream: (streamInput) => client.chat.completions.create({
      cacheKey: `manual-compaction:${input.conversationId}`,
      messages: streamInput.messages,
      model: streamInput.model,
      reasoningEffort: streamInput.reasoningEffort as typeof input.reasoningEffort,
      signal: streamInput.signal,
      system: streamInput.system,
    }),
    messages: input.messages,
    modelId,
    providerId: input.providerId,
    reasoningEffort: input.reasoningEffort,
    targetModelId: input.targetModelId,
    targetProviderId: input.targetProviderId,
    terminalExecutionMode: input.terminalExecutionMode,
  })
  return {
    compacted: result !== null,
    packetId: result?.packet.packetId ?? null,
    usedFallback: result?.usedFallback ?? false,
  }
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
          cacheKey: streamInput.cacheKey,
          messages: streamInput.messages,
          model: streamInput.model,
          reasoningEffort: streamInput.reasoningEffort,
          signal: streamInput.signal,
          maxSteps: streamInput.maxSteps,
          onStepEnd: streamInput.onStepEnd,
          repairToolCall: streamInput.repairToolCall,
          stopWhen: streamInput.stopWhen,
          system: streamInput.system,
          tools: streamInput.tools,
          prepareStep: streamInput.prepareStep,
        }),
      onSettled,
      promptOptions: { includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId) },
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
