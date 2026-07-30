import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  EstimateContextUsageInput,
  ContextUsageEstimate,
  CompressChatHistoryInput,
  StartChatStreamInput,
  StartChatStreamResult,
  SubmitToolDecisionInput,
  SubmitToolDecisionResult,
} from '../../../src/types/chat'
import { compressChatHistory } from '../shared/compression'
import { estimateToolEnabledContextUsage, runToolEnabledChatStream } from '../shared/runtime'
import { createCodexClient } from './client'
import { refreshProvidersCache } from '../../providers/service'

const activeStreams = new Map<string, AbortController>()

export async function estimateCodexContextUsage(
  webContents: WebContents,
  input: EstimateContextUsageInput,
): Promise<ContextUsageEstimate> {
  return estimateToolEnabledContextUsage({
    agentContextRootPath: input.agentContextRootPath,
    chatMode: input.chatMode,
    messages: input.messages,
    providerId: input.providerId,
    terminalExecutionMode: input.terminalExecutionMode,
    webContents,
  })
}

export async function compressCodexChatHistory(input: CompressChatHistoryInput): Promise<string> {
  if (input.providerId !== 'codex') {
    throw new Error('The Codex compression runtime only supports the Codex provider.')
  }

  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new Error('Select a model before compressing a chat.')
  }

  const client = createCodexClient()
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
          stopWhen: streamInput.stopWhen,
          system: streamInput.system,
          tools: streamInput.tools,
        }),
      onSettled,
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
    return
  }

  abortController.abort()
}

export async function submitCodexToolDecision(input: SubmitToolDecisionInput): Promise<SubmitToolDecisionResult> {
  void input
  throw new Error('Tool decisions are not implemented for the Codex backend yet.')
}
