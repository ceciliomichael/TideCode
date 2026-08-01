import type { ModelMessage } from 'ai'
import type { AppTerminalExecutionMode, ChatMode, ChatProviderId, Message, ReasoningEffort } from '../../../../src/types/chat'
import { approximateTokenCount } from '../../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings, type ContextCompactionSettings } from '../../../../src/lib/contextCompactionSettings'
import { buildSkillsSystemPromptBlock, listEnabledSkills } from '../../../skills/service'
import { recordCompactionCommitted } from '../../history/eventStore'
import { buildChatPrompt } from '../messages'
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
  const enabledSkills = await listEnabledSkills(input.agentContextRootPath)
  const prompt = buildChatPrompt({
    chatMode: input.chatMode,
    messages: input.messages,
    options: {
      availableSkillsBlock: buildSkillsSystemPromptBlock(enabledSkills),
      terminalExecutionMode: input.terminalExecutionMode,
    },
    workspaceRootPath: input.agentContextRootPath,
  })
  const result = await compactModelMessages({
    createStream: input.createStream,
    force: true,
    messages: prompt.messages,
    model: input.modelId,
    reasoningEffort: input.reasoningEffort,
    systemPromptTokens: approximateTokenCount(prompt.system),
    contextWindowTokens: contextCompaction.contextWindowTokens,
    reserveTokens: contextCompaction.reserveTokens,
    targetRatio: contextCompaction.targetPercent / 100,
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
    sourceDigest: result.sourceDigest,
    sourceMessageIds: result.packet.sourceMessageIds,
    usedFallback: result.usedFallback,
  })
  return result
}
