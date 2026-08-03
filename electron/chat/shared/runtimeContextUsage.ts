import type { WebContents } from 'electron'
import type {
  ContextUsageEstimate,
  Message,
  StartChatStreamInput,
} from '../../../src/types/chat'
import {
  approximateTokenCount,
  estimateModelMessageContextUsage,
} from '../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings } from '../../../src/lib/contextCompactionSettings'
import { listEnabledSkills } from '../../skills/service'
import { describeTools, stableStringify } from '../cache/canonicalization'
import { applyPromptCacheBreakpoints } from '../cache/providerPolicies'
import { readCanonicalHistory } from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { shouldReplayAssistantReasoning } from './assistantReasoningPolicy'
import { selectContextUsageMessages } from './contextUsageProjection'
import { buildChatPrompt } from './messages'
import { createAgentTools } from './tools'
import { sortToolSet } from './runtimeToolSet'

export async function estimateToolEnabledContextUsage(input: {
  agentContextRootPath: string | null
  chatMode: StartChatStreamInput['chatMode']
  conversationId?: string | null
  contextCompaction: StartChatStreamInput['contextCompaction']
  messages: Message[]
  modelId?: string
  providerId: StartChatStreamInput['providerId']
  terminalExecutionMode: StartChatStreamInput['terminalExecutionMode']
  webContents: WebContents
}): Promise<ContextUsageEstimate> {
  const contextCompaction = normalizeContextCompactionSettings(input.contextCompaction)
  const workspaceRootPath = input.agentContextRootPath?.trim() || 'No workspace selected'
  const enabledSkills = await listEnabledSkills(input.agentContextRootPath)
  const promptOptions = {
    includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId),
    terminalExecutionMode: input.terminalExecutionMode,
  }
  const prompt = buildChatPrompt({
    chatMode: input.chatMode,
    messages: input.messages,
    options: promptOptions,
    workspaceRootPath,
  })
  let modelMessages = prompt.messages
  if (input.conversationId?.trim() && input.modelId?.trim()) {
    const canonicalHistory = await readCanonicalHistory(input.conversationId.trim())
    const replay = projectCanonicalReplay({
      document: canonicalHistory,
      fallbackMessages: prompt.messages,
      messages: input.messages,
      modelId: input.modelId.trim(),
      options: promptOptions,
      providerId: input.providerId,
    })
    modelMessages = selectContextUsageMessages({
      canonicalMessages: replay.messages,
      fallbackMessages: prompt.messages,
      isCompacted: replay.isCompacted,
    })
  }
  const systemPrompt = prompt.system
  const messageUsage = estimateModelMessageContextUsage(modelMessages)
  let toolSchemaTokens = 0
  if (input.agentContextRootPath?.trim()) {
    const tools = await createAgentTools(
      {
        checkpointId: null,
        conversationId: null,
        workspaceRootPath: input.agentContextRootPath,
        terminalExecutionMode: input.terminalExecutionMode,
        webContents: input.webContents,
      },
      {
        chatMode: input.chatMode,
        enabledSkills,
        providerId: input.providerId,
      },
    )
    const cacheAwareTools = applyPromptCacheBreakpoints(sortToolSet(tools), input.providerId)
    toolSchemaTokens = approximateTokenCount(stableStringify(describeTools(cacheAwareTools)))
  }
  const systemPromptTokens = approximateTokenCount(systemPrompt) + toolSchemaTokens

  return {
    historyTokens: messageUsage.historyTokens,
    maxTokens: contextCompaction.contextWindowTokens,
    systemPromptTokens,
    toolResultsTokens: messageUsage.toolResultsTokens,
    totalTokens: messageUsage.totalTokens + systemPromptTokens,
  }
}
