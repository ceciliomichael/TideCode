import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { stepCountIs, type ModelMessage, type StopCondition, type ToolSet } from 'ai'
import { formatStructuredToolResultContent } from '../../../src/lib/toolResultContent'
import type {
  ChatStreamEvent,
  ContextUsageEstimate,
  Message,
  StartChatStreamInput,
  ToolInvocationResultPresentation,
} from '../../../src/types/chat'
import { buildSkillsSystemPromptBlock, listEnabledSkills } from '../../skills/service'
import { buildChatPrompt, buildChatSystemPrompt } from './messages'
import { createAgentTools } from './tools'
import type { AgentToolExecutionResult } from './toolTypes'

const CHAT_STREAM_EVENT_CHANNEL = 'chat:stream:event'
// Tool-heavy coding runs routinely exceed a dozen read/search/edit steps.
// Keep the limit high enough that the AI SDK does not terminate mid-task.
const MAX_TOOL_STEPS = 99999

interface ToolInvocationState {
  argumentsText: string
  startedAt: number
  toolName: string
}

interface RuntimeStreamPart {
  type: string
  [key: string]: unknown
}

interface RuntimePromptOptions {
  includeAssistantReasoningParts?: boolean
}

export interface ProviderStreamFactoryInput {
  messages: ModelMessage[]
  model: string
  reasoningEffort: StartChatStreamInput['reasoningEffort']
  signal: AbortSignal
  stopWhen: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  system: string
  tools: ToolSet
}

export type ProviderStreamFactory = (
  input: ProviderStreamFactoryInput,
) => Promise<{
  fullStream: AsyncIterable<RuntimeStreamPart>
}>

function emitChatStreamEvent(webContents: WebContents, payload: ChatStreamEvent) {
  if (webContents.isDestroyed()) {
    return
  }

  webContents.send(CHAT_STREAM_EVENT_CHANNEL, payload)
}

function approximateTokenCount(value: string) {
  const trimmedValue = value.trim()
  if (trimmedValue.length === 0) {
    return 0
  }

  return Math.ceil(trimmedValue.length / 4)
}

function isAgentToolExecutionResult(value: unknown): value is AgentToolExecutionResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<AgentToolExecutionResult>
  return (
    (candidate.status === 'success' || candidate.status === 'error') &&
    typeof candidate.summary === 'string' &&
    (candidate.body === undefined || typeof candidate.body === 'string')
  )
}

function normalizeToolExecutionResult(toolName: string, output: unknown): AgentToolExecutionResult {
  if (isAgentToolExecutionResult(output)) {
    return output
  }

  const summary = `Completed ${toolName}`
  if (typeof output === 'string') {
    return {
      body: output,
      status: 'success',
      summary,
    }
  }

  return {
    body: JSON.stringify(output, null, 2),
    status: 'success',
    summary,
  }
}

function isStreamPart(part: RuntimeStreamPart, type: string): boolean {
  return part.type === type
}

function stringifyToolArguments(input: unknown) {
  try {
    return JSON.stringify(input ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function createSyntheticToolMessage(
  invocationId: string,
  toolName: string,
  argumentsValue: unknown,
  completedAt: number,
  result: AgentToolExecutionResult,
): Message {
  // This JSON envelope is the exact tool output replayed back into the next model turn.
  // Edit `summary`, `body`, `subject`, or `semantics` here to change what the AI receives.
  return {
    content: formatStructuredToolResultContent(
      {
        arguments:
          typeof argumentsValue === 'object' && argumentsValue !== null
            ? (argumentsValue as Record<string, unknown>)
            : undefined,
        schema: 'echosphere.tool_result/v1',
        ...(result.semantics ? { semantics: result.semantics } : {}),
        status: result.status,
        ...(result.subject ? { subject: result.subject } : {}),
        summary: result.summary,
        toolCallId: invocationId,
        toolName,
        ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
      },
      result.body,
    ),
    id: randomUUID(),
    role: 'tool',
    timestamp: completedAt,
    toolCallId: invocationId,
  }
}

function getToolResultPresentation(result: AgentToolExecutionResult): ToolInvocationResultPresentation | undefined {
  return result.resultPresentation
}

function resolveActiveCheckpointId(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') {
      continue
    }

    const checkpointId = message.runCheckpoint?.id?.trim()
    if (checkpointId) {
      return checkpointId
    }
  }

  return null
}

export async function estimateToolEnabledContextUsage(input: {
  agentContextRootPath: string | null
  chatMode: StartChatStreamInput['chatMode']
  messages: Message[]
}): Promise<ContextUsageEstimate> {
  const workspaceRootPath = input.agentContextRootPath?.trim() || 'No workspace selected'
  const enabledSkills = await listEnabledSkills(input.agentContextRootPath)
  const systemPrompt = buildChatSystemPrompt(input.chatMode, workspaceRootPath, {
    availableSkillsBlock: buildSkillsSystemPromptBlock(enabledSkills),
  })
  let historyTokens = 0
  let toolResultsTokens = 0

  for (const message of input.messages) {
    if (message.role === 'tool') {
      toolResultsTokens += approximateTokenCount(message.content)
      continue
    }

    historyTokens += approximateTokenCount(message.content)
    historyTokens += approximateTokenCount(message.reasoningContent ?? '')
  }

  const systemPromptTokens = approximateTokenCount(systemPrompt)

  return {
    historyTokens,
    maxTokens: 0,
    systemPromptTokens,
    toolResultsTokens,
    totalTokens: historyTokens + systemPromptTokens + toolResultsTokens,
  }
}

export async function runToolEnabledChatStream(input: {
  abortController: AbortController
  createStream: ProviderStreamFactory
  onSettled?: () => void
  promptOptions?: RuntimePromptOptions
  startInput: StartChatStreamInput
  streamId: string
  webContents: WebContents
}) {
  const invocationStateById = new Map<string, ToolInvocationState>()
  let completedStepCount = 0
  let lastFinishReason: string | null = null

  try {
    const enabledSkills = await listEnabledSkills(input.startInput.agentContextRootPath)
    const tools = await createAgentTools(
      {
        checkpointId: resolveActiveCheckpointId(input.startInput.messages),
        conversationId: input.startInput.conversationId ?? null,
        workspaceRootPath: input.startInput.agentContextRootPath,
        terminalExecutionMode: input.startInput.terminalExecutionMode,
        webContents: input.webContents,
      },
      {
        chatMode: input.startInput.chatMode,
        enabledSkills,
        providerId: input.startInput.providerId,
      },
    )
    const prompt = buildChatPrompt({
      chatMode: input.startInput.chatMode,
      messages: input.startInput.messages,
      options: {
        ...input.promptOptions,
        availableSkillsBlock: buildSkillsSystemPromptBlock(enabledSkills),
      },
      workspaceRootPath: input.startInput.agentContextRootPath,
    })
    const stream = await input.createStream({
      messages: prompt.messages,
      model: input.startInput.modelId,
      reasoningEffort: input.startInput.reasoningEffort,
      signal: input.abortController.signal,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      system: prompt.system,
      tools,
    })

    emitChatStreamEvent(input.webContents, {
      streamId: input.streamId,
      type: 'started',
    })

    for await (const part of stream.fullStream) {
      if (isStreamPart(part, 'text-delta') && typeof part.text === 'string') {
        emitChatStreamEvent(input.webContents, {
          delta: part.text,
          streamId: input.streamId,
          type: 'content_delta',
        })
        continue
      }

      if (isStreamPart(part, 'reasoning-delta') && typeof part.text === 'string') {
        emitChatStreamEvent(input.webContents, {
          delta: part.text,
          streamId: input.streamId,
          type: 'reasoning_delta',
        })
        continue
      }

      if (isStreamPart(part, 'reasoning-end')) {
        emitChatStreamEvent(input.webContents, {
          streamId: input.streamId,
          type: 'reasoning_completed',
        })
        continue
      }

      if (isStreamPart(part, 'tool-input-start') && typeof part.id === 'string' && typeof part.toolName === 'string') {
        const startedAt = Date.now()
        invocationStateById.set(part.id, {
          argumentsText: '',
          startedAt,
          toolName: part.toolName,
        })
        emitChatStreamEvent(input.webContents, {
          argumentsText: '',
          invocationId: part.id,
          startedAt,
          streamId: input.streamId,
          toolName: part.toolName,
          type: 'tool_invocation_started',
        })
        continue
      }

      if (isStreamPart(part, 'tool-input-delta') && typeof part.id === 'string' && typeof part.delta === 'string') {
        const currentState = invocationStateById.get(part.id) ?? {
          argumentsText: '',
          startedAt: Date.now(),
          toolName: 'tool',
        }
        const nextArgumentsText = currentState.argumentsText + part.delta
        invocationStateById.set(part.id, {
          ...currentState,
          argumentsText: nextArgumentsText,
        })
        emitChatStreamEvent(input.webContents, {
          argumentsText: nextArgumentsText,
          invocationId: part.id,
          streamId: input.streamId,
          toolName: currentState.toolName,
          type: 'tool_invocation_delta',
        })
        continue
      }

      if (
        isStreamPart(part, 'tool-call') &&
        typeof part.toolCallId === 'string' &&
        typeof part.toolName === 'string'
      ) {
        const currentState = invocationStateById.get(part.toolCallId)
        const argumentsText = stringifyToolArguments(part.input)
        if (!currentState) {
          const startedAt = Date.now()
          invocationStateById.set(part.toolCallId, {
            argumentsText,
            startedAt,
            toolName: part.toolName,
          })
          emitChatStreamEvent(input.webContents, {
            argumentsText,
            invocationId: part.toolCallId,
            startedAt,
            streamId: input.streamId,
            toolName: part.toolName,
            type: 'tool_invocation_started',
          })
          continue
        }

        if (currentState.argumentsText !== argumentsText) {
          invocationStateById.set(part.toolCallId, {
            ...currentState,
            argumentsText,
          })
          emitChatStreamEvent(input.webContents, {
            argumentsText,
            invocationId: part.toolCallId,
            streamId: input.streamId,
            toolName: part.toolName,
            type: 'tool_invocation_delta',
          })
        }
        continue
      }

      if (
        isStreamPart(part, 'tool-result') &&
        typeof part.toolCallId === 'string' &&
        typeof part.toolName === 'string'
      ) {
        if (input.abortController.signal.aborted) {
          invocationStateById.delete(part.toolCallId)
          continue
        }

        const currentState = invocationStateById.get(part.toolCallId) ?? {
          argumentsText: stringifyToolArguments(part.input),
          startedAt: Date.now(),
          toolName: part.toolName,
        }
        const completedAt = Date.now()
        const normalizedResult = normalizeToolExecutionResult(part.toolName, part.output)
        const syntheticMessage = createSyntheticToolMessage(
          part.toolCallId,
          part.toolName,
          part.input,
          completedAt,
          normalizedResult,
        )
        const payload = {
          argumentsText: currentState.argumentsText,
          completedAt,
          invocationId: part.toolCallId,
          resultContent: syntheticMessage.content,
          ...(getToolResultPresentation(normalizedResult)
            ? { resultPresentation: getToolResultPresentation(normalizedResult) }
            : {}),
          streamId: input.streamId,
          syntheticMessage,
          toolName: part.toolName,
        } as const

        invocationStateById.delete(part.toolCallId)
        if (normalizedResult.status === 'error') {
          emitChatStreamEvent(input.webContents, {
            ...payload,
            errorMessage: normalizedResult.summary,
            type: 'tool_invocation_failed',
          })
          continue
        }

        emitChatStreamEvent(input.webContents, {
          ...payload,
          type: 'tool_invocation_completed',
        })
        continue
      }

      if (
        isStreamPart(part, 'tool-error') &&
        typeof part.toolCallId === 'string' &&
        typeof part.toolName === 'string'
      ) {
        if (input.abortController.signal.aborted) {
          invocationStateById.delete(part.toolCallId)
          continue
        }

        const currentState = invocationStateById.get(part.toolCallId)
        const completedAt = Date.now()
        const errorMessage =
          (part.error instanceof Error && part.error.message.trim().length > 0
            ? part.error.message
            : null) || `Tool ${part.toolName} failed before returning a result.`
        const syntheticMessage = createSyntheticToolMessage(
          part.toolCallId,
          part.toolName,
          part.input,
          completedAt,
          {
            body: errorMessage,
            status: 'error',
            summary: errorMessage,
          },
        )

        invocationStateById.delete(part.toolCallId)
        emitChatStreamEvent(input.webContents, {
          argumentsText: currentState?.argumentsText ?? stringifyToolArguments(part.input),
          completedAt,
          errorMessage,
          invocationId: part.toolCallId,
          resultContent: syntheticMessage.content,
          streamId: input.streamId,
          syntheticMessage,
          toolName: part.toolName,
          type: 'tool_invocation_failed',
        })
      }

      if (isStreamPart(part, 'finish')) {
        completedStepCount += 1
        lastFinishReason = typeof part.finishReason === 'string' ? part.finishReason : null
      }
    }

    if (completedStepCount >= MAX_TOOL_STEPS && lastFinishReason === 'tool-calls') {
      emitChatStreamEvent(input.webContents, {
        errorMessage: `The assistant hit the tool-step limit (${MAX_TOOL_STEPS}) before finishing. Increase the limit or continue the task in a follow-up turn.`,
        streamId: input.streamId,
        type: 'error',
      })
      return
    }

    emitChatStreamEvent(input.webContents, {
      streamId: input.streamId,
      type: 'completed',
    })
  } catch (error) {
    if (input.abortController.signal.aborted) {
      emitChatStreamEvent(input.webContents, {
        streamId: input.streamId,
        type: 'aborted',
      })
    } else {
      emitChatStreamEvent(input.webContents, {
        errorMessage: error instanceof Error && error.message.trim().length > 0 ? error.message : 'Chat request failed.',
        streamId: input.streamId,
        type: 'error',
      })
    }
  } finally {
    input.onSettled?.()
  }
}
