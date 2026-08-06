import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  EstimateContextUsageInput,
  ContextUsageEstimate,
  CompactConversationInput,
  CompactConversationResult,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from '../../../src/types/chat'
import { estimateToolEnabledContextUsage, runToolEnabledChatStream } from '../shared/runtime'
import { createCodexClient } from './client'
import { refreshProvidersCache } from '../../providers/service'
import { compactConversationForProvider } from '../shared/compaction/manual'

const activeStreams = new Map<string, AbortController>()

export async function estimateCodexContextUsage(
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

export async function compactCodexConversation(input: CompactConversationInput): Promise<CompactConversationResult> {
  if (input.providerId !== 'codex') {
    throw new Error('The Codex compaction runtime only supports the Codex provider.')
  }
  if (!input.conversationId.trim()) {
    throw new Error('A saved conversation is required before compacting it.')
  }

  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error('Select a model before compacting a chat.')
  }

  const client = createCodexClient()
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

export async function startCodexChatStream(
  webContents: WebContents,
  input: StartChatStreamInput,
  onSettled?: () => void,
): Promise<StartChatStreamResult> {
  if (input.providerId !== 'codex') {
    throw new Error('The Codex chat runtime only supports the Codex provider.')
  }

  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error('Select a model before starting a chat.')
  }

  const streamId = randomUUID()
  const abortController = new AbortController()
  activeStreams.set(streamId, abortController)

  queueMicrotask(() => {
    void runCodexChatStream(webContents, streamId, input, abortController, onSettled)
  })

  return { streamId }
}

async function runCodexChatStream(
  webContents: WebContents,
  streamId: string,
  input: StartChatStreamInput,
  abortController: AbortController,
  onSettled?: () => void,
) {
  try {
    const client = createCodexClient()
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
      // Codex uses the OpenAI Responses adapter. Visible reasoning restored
      // from the UI history is not a valid Responses reasoning item unless it
      // still carries the provider's item metadata. Exact canonical replay
      // keeps that metadata; legacy/fallback history must not synthesize a
      // generic reasoning part that the adapter will discard with a warning.
      promptOptions: { includeAssistantReasoningParts: false },
      startInput: input,
      streamId,
      webContents,
    })
  } catch (error) {
    if (!abortController.signal.aborted) {
      throw error
    }
  } finally {
    activeStreams.delete(streamId)
    void refreshProvidersCache(true).catch(() => {})
  }
}

export async function cancelCodexChatStream(streamId: string) {
  const abortController = activeStreams.get(streamId)
  if (!abortController) {
    return false
  }

  abortController.abort()
  return true
}

export async function submitCodexToolDecision(input: SubmitToolDecisionInput): Promise<SubmitToolDecisionResult> {
  void input
  throw new Error('Tool decisions are not implemented for the Codex backend yet.')
}
