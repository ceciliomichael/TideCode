import type { WebContents } from 'electron'
import type {
  ContextUsageEstimate,
  Message,
  StartChatStreamInput,
} from '../../../src/types/chat'
import type { ChatStreamEventTarget } from './runtimeStreamEvents'
import {
  approximateTokenCount,
  estimateModelMessageContextUsage,
} from '../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings } from '../../../src/lib/contextCompactionSettings'
import { describeTools, stableStringify } from '../cache/canonicalization'
import { applyPromptCacheBreakpoints } from '../cache/providerPolicies'
import { readCanonicalHistory } from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { shouldReplayAssistantReasoning } from './assistantReasoningPolicy'
import { selectContextUsageMessages } from './contextUsageProjection'
import { buildChatPrompt, stripImageAttachmentsFromModelMessages } from './messages'
import { applyWorkspaceInstructionsContext } from './prompts/workspaceInstructions'
import { resolveModelImageInputSupport } from './modelImageSupport'
import { createAgentToolSchemaSet } from './tools'
import { sortToolSet } from './runtimeToolSet'
import { assertWorkspaceDirectory, normalizeWorkspacePath } from '../../workspace/paths'

const toolSchemaTokenCounts = new Map<string, number>()

function isMissingWorkspacePathError(error: unknown) {
  return error instanceof Error && error.message.startsWith('Workspace path does not exist:')
}

async function resolveAvailableWorkspaceRootPath(workspaceRootPath: string | null) {
  if (!workspaceRootPath?.trim()) {
    return null
  }

  const normalizedWorkspaceRootPath = normalizeWorkspacePath(workspaceRootPath)
  try {
    await assertWorkspaceDirectory(normalizedWorkspaceRootPath)
    return normalizedWorkspaceRootPath
  } catch (error) {
    if (isMissingWorkspacePathError(error)) {
      return null
    }
    throw error
  }
}

function estimateToolSchemaTokens(providerId: StartChatStreamInput['providerId']) {
  const cachedTokenCount = toolSchemaTokenCounts.get(providerId)
  if (cachedTokenCount !== undefined) {
    return cachedTokenCount
  }

  const tools = applyPromptCacheBreakpoints(
    sortToolSet(createAgentToolSchemaSet(providerId)),
    providerId,
  )
  const tokenCount = approximateTokenCount(stableStringify(describeTools(tools)))
  toolSchemaTokenCounts.set(providerId, tokenCount)
  return tokenCount
}

export async function estimateToolEnabledContextUsage(input: {
  agentContextRootPath: string | null
  chatMode: StartChatStreamInput['chatMode']
  conversationId?: string | null
  contextCompaction: StartChatStreamInput['contextCompaction']
  messages: Message[]
  modelId?: string
  providerId: StartChatStreamInput['providerId']
  terminalExecutionMode: StartChatStreamInput['terminalExecutionMode']
  webContents?: WebContents | ChatStreamEventTarget | null
}): Promise<ContextUsageEstimate> {
  const contextCompaction = normalizeContextCompactionSettings(input.contextCompaction)
  const conversationId = input.conversationId?.trim()
  const modelId = input.modelId?.trim()
  const [normalizedWorkspaceRootPath, includeImageAttachments, canonicalHistory] = await Promise.all([
    resolveAvailableWorkspaceRootPath(input.agentContextRootPath),
    resolveModelImageInputSupport(input.providerId, input.modelId ?? ''),
    conversationId && modelId
      ? readCanonicalHistory(conversationId)
      : Promise.resolve(null),
  ])
  const workspaceRootPath = normalizedWorkspaceRootPath ?? 'No workspace selected'
  const promptOptions = {
    includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId),
    includeImageAttachments,
    terminalExecutionMode: input.terminalExecutionMode,
  }
  const prompt = buildChatPrompt({
    chatMode: input.chatMode,
    messages: input.messages,
    options: promptOptions,
    workspaceRootPath,
  })
  let modelMessages = prompt.messages
  if (canonicalHistory && conversationId && modelId) {
    const replay = projectCanonicalReplay({
      document: canonicalHistory,
      fallbackMessages: prompt.messages,
      messages: input.messages,
      modelId,
      options: promptOptions,
      providerId: input.providerId,
    })
    modelMessages = selectContextUsageMessages({
      canonicalMessages: replay.messages,
      fallbackMessages: prompt.messages,
      isCompacted: replay.isCompacted,
    })
  }
  if (!promptOptions.includeImageAttachments) {
    modelMessages = stripImageAttachmentsFromModelMessages(modelMessages)
  }
  if (modelMessages.some((message) => message.role === 'user')) {
    modelMessages = applyWorkspaceInstructionsContext(modelMessages, normalizedWorkspaceRootPath)
  }
  const systemPrompt = prompt.system
  const messageUsage = estimateModelMessageContextUsage(modelMessages)
  const toolSchemaTokens = normalizedWorkspaceRootPath
    ? estimateToolSchemaTokens(input.providerId)
    : 0
  const systemPromptTokens = approximateTokenCount(systemPrompt)

  return {
    historyTokens: messageUsage.historyTokens,
    injectionTokens: messageUsage.injectionTokens,
    maxTokens: contextCompaction.contextWindowTokens,
    systemPromptTokens,
    toolSchemaTokens,
    toolResultsTokens: messageUsage.toolResultsTokens,
    totalTokens: messageUsage.totalTokens + systemPromptTokens + toolSchemaTokens,
  }
}
