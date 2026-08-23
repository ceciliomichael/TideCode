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
import { listEnabledSkills } from '../../skills/service'
import { describeTools, stableStringify } from '../cache/canonicalization'
import { applyPromptCacheBreakpoints } from '../cache/providerPolicies'
import { readCanonicalHistory } from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { shouldReplayAssistantReasoning } from './assistantReasoningPolicy'
import { selectContextUsageMessages } from './contextUsageProjection'
import { buildChatPrompt, stripImageAttachmentsFromModelMessages } from './messages'
import { resolveModelImageInputSupport } from './modelImageSupport'
import { createAgentToolBundle } from './tools'
import { sortToolSet } from './runtimeToolSet'
import { assertWorkspaceDirectory, normalizeWorkspacePath } from '../../workspace/paths'

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
  const normalizedWorkspaceRootPath = await resolveAvailableWorkspaceRootPath(input.agentContextRootPath)
  const workspaceRootPath = normalizedWorkspaceRootPath ?? 'No workspace selected'
  const enabledSkills = normalizedWorkspaceRootPath
    ? await listEnabledSkills(normalizedWorkspaceRootPath)
    : []
  const orchestrationMode = 'code_mode' as const
  const promptOptions = {
    includeAssistantReasoningParts: shouldReplayAssistantReasoning(input.providerId),
    includeImageAttachments: await resolveModelImageInputSupport(input.providerId, input.modelId ?? ''),
    orchestrationMode,
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
  if (!promptOptions.includeImageAttachments) {
    modelMessages = stripImageAttachmentsFromModelMessages(modelMessages)
  }
  const systemPrompt = prompt.system
  const messageUsage = estimateModelMessageContextUsage(modelMessages)
  let toolSchemaTokens = 0
  if (normalizedWorkspaceRootPath) {
    try {
      const toolBundle = await createAgentToolBundle(
        {
          checkpointId: null,
          conversationId: null,
          workspaceRootPath: normalizedWorkspaceRootPath,
          terminalExecutionMode: input.terminalExecutionMode,
          webContents: input.webContents,
        },
        {
          chatMode: input.chatMode,
          enabledSkills,
          orchestrationMode,
          providerId: input.providerId,
        },
      )
      try {
        const cacheAwareTools = applyPromptCacheBreakpoints(sortToolSet(toolBundle.tools), input.providerId)
        toolSchemaTokens = approximateTokenCount(stableStringify(describeTools(cacheAwareTools)))
      } finally {
        await toolBundle.codeModeExecutor?.dispose()
      }
    } catch (error) {
      if (!isMissingWorkspacePathError(error)) {
        throw error
      }
    }
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
