import type { ModelMessage } from 'ai'
import type { AppTerminalExecutionMode, ChatMode, ChatProviderId, Message, ReasoningEffort } from '../../../../src/types/chat'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings, type ContextCompactionSettings } from '../../../../src/lib/contextCompactionSettings'
import {
  readCanonicalHistory,
  readLatestCompactionPacket,
  readLatestConversationMemory,
  recordCompactionCommitted,
  recordCompactionAttempt,
  captureCompactionSource,
} from '../../history/eventStore'
import { projectCanonicalReplay } from '../../history/replayProjector'
import { shouldReplayAssistantReasoning } from '../assistantReasoningPolicy'
import { buildChatPrompt, stripImageAttachmentsFromModelMessages } from '../messages'
import { applyWorkspaceInstructionsContext } from '../prompts/workspaceInstructions'
import { applyConversationMemoryContext, applyWorkspaceMemoryContext } from '../memory/runtimeContext'
import { getStoredSettings } from '../../../settings/store'
import { resolveModelImageInputSupport } from '../modelImageSupport'
import { sanitizeModelMessages } from '../modelMessageIntegrity'
import { compactModelMessages } from './service'
import type { CompactionStreamFactory } from './contracts'
import type { CompactConversationResult } from '../../../../src/types/chat'
import { coordinateCompaction, createCompactionSession } from './coordinator'
import { resolveContextCapabilities, resolveStoredOutputMaximum } from '../contextCapabilities'
import { prepareContextRequest } from '../contextRequest'
import { budgetCompactionStream } from './modelSelection'
import { estimateToolSchemaTokens } from '../runtimeContextUsage'
import { CompactionError } from './gate'

export interface CompactConversationInput {
  agentContextRootPath: string
  chatMode: ChatMode
  conversationId: string
  contextCompaction: ContextCompactionSettings
  createStream: CompactionStreamFactory
  messages: Message[]
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  targetModelId?: string
  targetProviderId?: ChatProviderId
  terminalExecutionMode: AppTerminalExecutionMode
}

export async function compactConversationForProvider(input: CompactConversationInput): Promise<CompactConversationResult> {
  const contextCompaction = normalizeContextCompactionSettings(input.contextCompaction)
  const sourceProviderId = input.targetProviderId ?? input.providerId
  const sourceModelId = input.targetModelId?.trim() || input.modelId
  const includeImageAttachments = await resolveModelImageInputSupport(sourceProviderId, sourceModelId)
  const prompt = buildChatPrompt({
    chatMode: input.chatMode,
    messages: input.messages,
    options: {
      includeAssistantReasoningParts: shouldReplayAssistantReasoning(sourceProviderId),
      includeImageAttachments,
      terminalExecutionMode: input.terminalExecutionMode,
    },
    workspaceRootPath: input.agentContextRootPath,
  })
  const canonicalHistory = await readCanonicalHistory(input.conversationId)
  const replay = projectCanonicalReplay({
    document: canonicalHistory,
    fallbackMessages: prompt.messages,
    messages: input.messages,
    modelId: sourceModelId,
    options: {
      includeAssistantReasoningParts: shouldReplayAssistantReasoning(sourceProviderId),
      includeImageAttachments,
      terminalExecutionMode: input.terminalExecutionMode,
    },
    providerId: sourceProviderId,
  })
  const storedSettings = await getStoredSettings().catch(() => null)
  const previousMemory = await readLatestConversationMemory(input.conversationId)
  const workspaceMessages = await applyWorkspaceMemoryContext(
    applyWorkspaceInstructionsContext(
      includeImageAttachments
        ? replay.messages
        : stripImageAttachmentsFromModelMessages(replay.messages),
      input.agentContextRootPath,
    ),
    input.agentContextRootPath,
    storedSettings?.workspaceMemoryEnabled ?? true,
  )
  const safeModelMessages = sanitizeModelMessages(
    applyConversationMemoryContext(workspaceMessages, previousMemory),
  )
  const previousPacket = await readLatestCompactionPacket(input.conversationId)
  const capabilities = resolveContextCapabilities({
    providerId: sourceProviderId, modelId: sourceModelId,
    contextWindowTokens: contextCompaction.contextWindowTokens,
    maximumOutputTokens: await resolveStoredOutputMaximum(sourceProviderId, sourceModelId),
  })
  const makeRequest = (messages: ModelMessage[]) => prepareContextRequest({
    messages, capabilities,
    systemPromptTokens: approximateTokenCount(prompt.system),
    toolSchemaTokens: estimateToolSchemaTokens(sourceProviderId),
    triggerRatio: contextCompaction.triggerPercent / 100,
  })
  const request = makeRequest(safeModelMessages)
  const expectedSource = captureCompactionSource(canonicalHistory)
  try {
    const outcome = await coordinateCompaction({
      request, session: createCompactionSession(), previousPacket, manual: true,
      retainedContextTokens: contextCompaction.retainedContextTokens,
      report: (diagnostic) => recordCompactionAttempt(input.conversationId, null, diagnostic).then(() => undefined),
      run: (window, targetTokens, diagnostic) => compactModelMessages({
        conversationId: input.conversationId,
        createStream: budgetCompactionStream(input.createStream, input.providerId, contextCompaction.contextWindowTokens),
        selectedWindow: window, force: true,
        messages: request.durableMessages, model: input.modelId, providerId: input.providerId,
        previousPacket, previousMemory, workspaceRootPath: input.agentContextRootPath,
        reasoningEffort: input.reasoningEffort,
        sourceModel: sourceModelId, sourceProviderId,
        systemPromptTokens: approximateTokenCount(prompt.system),
        contextWindowTokens: contextCompaction.contextWindowTokens,
        retainedContextTokens: targetTokens,
        triggerRatio: contextCompaction.triggerPercent / 100,
        toolSchemaTokens: estimateToolSchemaTokens(sourceProviderId), turnState: 'settled',
        onWorkerUsage: (operation, usage) => diagnostic.workerUsage.push({ operation, usage }),
      }),
      rebuild: async (result) => {
        result.projectedMessages = await applyWorkspaceMemoryContext(
          result.projectedMessages, input.agentContextRootPath, storedSettings?.workspaceMemoryEnabled ?? true,
        )
        return makeRequest(result.projectedMessages)
      },
      commit: (result, diagnostic) => recordCompactionCommitted({
        expectedSource, diagnostic,
        anchorUserMessageId: [...input.messages].reverse().find((message) => message.role === 'user')?.id ?? null,
        compactionId: result.packet.packetId, conversationId: input.conversationId,
        modelId: sourceModelId, durableMemory: result.durableMemory, packet: result.packet,
        projectedMessages: result.projectedMessages, providerId: sourceProviderId,
        projectionVersion: result.projectionVersion, reasoningRetention: result.reasoningRetention,
        parentPacketId: result.packet.parentPacketId, sourceDigest: result.sourceDigest,
        sourceMessageIds: result.packet.sourceMessageIds,
      }).then(() => undefined),
    })
    if (outcome.status === 'compacted') {
      return { compacted: true, packetId: outcome.result.packet.packetId }
    }
    return { compacted: false, packetId: null, reason: 'no_compactable_source' }
  } catch (error) {
    if (error instanceof CompactionError && ['no_compactable_source', 'insufficient_reduction'].includes(error.reason)) {
      return { compacted: false, packetId: null, reason: error.reason }
    }
    throw error
  }
}
