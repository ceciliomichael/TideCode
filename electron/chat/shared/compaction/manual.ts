import type { ModelMessage } from 'ai'
import type { AppTerminalExecutionMode, ChatMode, ChatProviderId, Message, ReasoningEffort } from '../../../../src/types/chat'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings, type ContextCompactionSettings } from '../../../../src/lib/contextCompactionSettings'
import { readCanonicalHistory, readLatestCompactionPacket, recordCompactionCommitted } from '../../history/eventStore'
import { projectCanonicalReplay } from '../../history/replayProjector'
import { shouldReplayAssistantReasoning } from '../assistantReasoningPolicy'
import { buildChatPrompt } from '../messages'
import { sanitizeModelMessages } from '../modelMessageIntegrity'
import { compactModelMessages } from './service'
import type { CompactionStreamFactory, CompactionResult } from './contracts'

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

export async function compactConversationForProvider(input: CompactConversationInput): Promise<CompactionResult | null> {
  const contextCompaction = normalizeContextCompactionSettings(input.contextCompaction)
  const prompt = buildChatPrompt({
    chatMode: input.chatMode,
    messages: input.messages,
    options: {
      includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId),
      terminalExecutionMode: input.terminalExecutionMode,
    },
    workspaceRootPath: input.agentContextRootPath,
  })
  const canonicalHistory = await readCanonicalHistory(input.conversationId)
  const replay = projectCanonicalReplay({
    document: canonicalHistory,
    fallbackMessages: prompt.messages,
    messages: input.messages,
    modelId: input.modelId,
    options: {
      includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId),
      terminalExecutionMode: input.terminalExecutionMode,
    },
    providerId: input.providerId,
  })
  const safeModelMessages = sanitizeModelMessages(replay.messages)
  const previousPacket = await readLatestCompactionPacket(input.conversationId)
  const result = await compactModelMessages({
    createStream: input.createStream,
    force: true,
    messages: safeModelMessages,
    model: input.modelId,
    providerId: input.providerId,
    previousPacket,
    reasoningEffort: input.reasoningEffort,
    systemPromptTokens: approximateTokenCount(prompt.system),
    contextWindowTokens: contextCompaction.contextWindowTokens,
    retainedContextTokens: contextCompaction.retainedContextTokens,
    triggerRatio: contextCompaction.triggerPercent / 100,
    toolSchemaTokens: 0,
  })
  if (!result) return null

  await recordCompactionCommitted({
    anchorUserMessageId: [...input.messages].reverse().find((message) => message.role === 'user')?.id ?? null,
    compactionId: result.packet.packetId,
    conversationId: input.conversationId,
    modelId: input.targetModelId?.trim() || input.modelId,
    packet: result.packet,
    projectedMessages: result.projectedMessages as ModelMessage[],
    providerId: input.targetProviderId ?? input.providerId,
    projectionVersion: result.projectionVersion,
    reasoningRetention: result.reasoningRetention,
    parentPacketId: result.packet.parentPacketId,
    sourceDigest: result.sourceDigest,
    sourceMessageIds: result.packet.sourceMessageIds,
  })
  return result
}
