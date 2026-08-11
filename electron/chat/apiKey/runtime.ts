import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  ApiKeyProviderId,
  CompactConversationInput,
  CompactConversationResult,
  ContextUsageEstimate,
  EstimateContextUsageInput,
  StartChatStreamInput,
  StartChatStreamResult,
  UpdatePendingSteerMessagesInput,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from '../../../src/types/chat'
import { ActiveChatStreamRegistry } from '../shared/activeChatStreamRegistry'
import type { ActiveChatStreamRegistration } from '../shared/activeChatStreamRegistry'
import { shouldReplayAssistantReasoning } from '../shared/assistantReasoningPolicy'
import { estimateToolEnabledContextUsage, runToolEnabledChatStream } from '../shared/runtime'
import { emitChatStreamEvent } from '../shared/runtimeStreamEvents'
import { createApiKeyChatClient } from './client'
import { compactConversationForProvider } from '../shared/compaction/manual'

const activeStreams = new ActiveChatStreamRegistry()

async function loadApiKeyChatProviderConfig(providerId: ApiKeyProviderId) {
  const { readApiKeyChatProviderConfig } = await import('./config')
  return readApiKeyChatProviderConfig(providerId)
}

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

  const config = await loadApiKeyChatProviderConfig(input.providerId)
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
  const registration = activeStreams.register(streamId, abortController)

  queueMicrotask(() => {
    void runApiKeyChatStream(webContents, streamId, input, abortController, registration.steering)
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return
        }

        emitChatStreamEvent(webContents, {
          errorMessage:
            error instanceof Error && error.message.trim().length > 0 ? error.message : 'Chat request failed.',
          streamId,
          type: 'error',
        })
      })
      .finally(() => {
        activeStreams.settle(streamId)
        onSettled?.()
      })
  })
  return { streamId }
}

async function runApiKeyChatStream(
  webContents: WebContents,
  streamId: string,
  input: StartChatStreamInput,
  abortController: AbortController,
  steering: ActiveChatStreamRegistration['steering'],
) {
  if (input.providerId === 'codex') {
    throw new Error('Codex streams must use the Codex runtime.')
  }
  const config = await loadApiKeyChatProviderConfig(input.providerId)
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
    promptOptions: { includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId) },
    startInput: input,
    steering,
    streamId,
    webContents,
  })
}

export function cancelApiKeyChatStream(streamId: string) {
  return activeStreams.cancel(streamId)
}

export function updateApiKeyPendingSteerMessages(input: UpdatePendingSteerMessagesInput) {
  return {
    accepted: activeStreams.updatePendingSteerMessages(input.streamId, input),
  }
}

export async function submitApiKeyToolDecision(
  input: SubmitToolDecisionInput,
): Promise<SubmitToolDecisionResult> {
  void input
  throw new Error('Tool decisions are not implemented for API-key providers yet.')
}
