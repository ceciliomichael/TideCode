import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { stepCountIs, type ModelMessage, type StopCondition, type ToolSet } from 'ai'
import type {
  ChatStreamEvent,
  ContextUsageEstimate,
  Message,
  StartChatStreamInput,
  ToolInvocationResultPresentation,
} from '../../../src/types/chat'
import { approximateTokenCount, estimateMessageContextUsage } from '../../../src/lib/contextUsage'
import { buildSkillsSystemPromptBlock, listEnabledSkills } from '../../skills/service'
import { buildPromptContextManifest, describeTools, stableStringify } from '../cache/canonicalization'
import { derivePromptCacheKey } from '../cache/providerPolicies'
import type { ProviderStepRecord } from '../history/contracts'
import {
  readCanonicalHistory,
  recordContextEpoch,
  recordRunCompleted,
  recordRunStarted,
  recordRunTerminal,
  recordStepCompleted,
  recordToolFreshness,
  synchronizeCanonicalMessages,
} from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { buildChatPrompt, buildChatSystemPrompt } from './messages'
import { createAgentTools } from './tools'
import { captureWorkspaceCheckpointTerminalPostState } from '../../workspace/checkpoints'
import type { AgentToolExecutionResult } from './toolTypes'
import {
  createCanonicalToolResultContent,
  normalizeToolExecutionResult,
  withCanonicalToolModelOutputs,
} from './toolReplay'

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
  cacheKey: string
  messages: ModelMessage[]
  model: string
  reasoningEffort: StartChatStreamInput['reasoningEffort']
  signal: AbortSignal
  stopWhen: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
  maxSteps?: number
  system: string
  tools: ToolSet
  onStepEnd?: (step: ProviderStepRecord) => void | Promise<void>
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

function sortToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
  ) as ToolSet
}

function createSyntheticToolMessage(
  invocationId: string,
  toolName: string,
  argumentsValue: unknown,
  completedAt: number,
  result: AgentToolExecutionResult,
): Message {
  return {
    content: createCanonicalToolResultContent({
      argumentsValue,
      result,
      toolCallId: invocationId,
      toolName,
    }),
    id: randomUUID(),
    role: 'tool',
    timestamp: completedAt,
    toolCallId: invocationId,
  }
}

async function safelyPersistHistory(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    console.error('Canonical chat history persistence failed.', error)
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
  providerId: StartChatStreamInput['providerId']
  terminalExecutionMode: StartChatStreamInput['terminalExecutionMode']
  webContents: WebContents
}): Promise<ContextUsageEstimate> {
  const workspaceRootPath = input.agentContextRootPath?.trim() || 'No workspace selected'
  const enabledSkills = await listEnabledSkills(input.agentContextRootPath)
  const systemPrompt = buildChatSystemPrompt(input.chatMode, workspaceRootPath, {
    availableSkillsBlock: buildSkillsSystemPromptBlock(),
    terminalExecutionMode: input.terminalExecutionMode,
  })
  const messageUsage = estimateMessageContextUsage(input.messages)
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
    toolSchemaTokens = approximateTokenCount(stableStringify(describeTools(sortToolSet(tools))))
  }
  const systemPromptTokens = approximateTokenCount(systemPrompt) + toolSchemaTokens

  return {
    historyTokens: messageUsage.historyTokens,
    maxTokens: 0,
    systemPromptTokens,
    toolResultsTokens: messageUsage.toolResultsTokens,
    totalTokens: messageUsage.totalTokens + systemPromptTokens,
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
  const runId = randomUUID()
  const conversationId = input.startInput.conversationId?.trim() || null
  let completedStepCount = 0
  let lastFinishReason: string | null = null
  let runWasRecorded = false
  let queuedHistoryWrites = Promise.resolve()
  const queueHistoryWrite = (action: () => Promise<unknown>) => {
    queuedHistoryWrites = queuedHistoryWrites.then(() => safelyPersistHistory(action))
  }

  try {
    const enabledSkills = await listEnabledSkills(input.startInput.agentContextRootPath)
    const rawTools = await createAgentTools(
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
    const tools = withCanonicalToolModelOutputs(sortToolSet(rawTools))
    const promptOptions = {
      ...input.promptOptions,
      availableSkillsBlock: buildSkillsSystemPromptBlock(),
      terminalExecutionMode: input.startInput.terminalExecutionMode,
    }
    const prompt = buildChatPrompt({
      chatMode: input.startInput.chatMode,
      messages: input.startInput.messages,
      options: promptOptions,
      workspaceRootPath: input.startInput.agentContextRootPath,
    })
    const promptContext = buildPromptContextManifest({
      modelId: input.startInput.modelId,
      providerId: input.startInput.providerId,
      system: prompt.system,
      tools,
    })
    const contextFingerprint = promptContext.fingerprint
    let modelMessages = prompt.messages
    let freshnessRevision = 0
    let replayFidelity: 'exact' | 'migrated_legacy' = 'migrated_legacy'

    if (conversationId) {
      await safelyPersistHistory(() => synchronizeCanonicalMessages(conversationId, input.startInput.messages))
      await safelyPersistHistory(() => recordContextEpoch(conversationId, promptContext))
      const canonicalHistory = await readCanonicalHistory(conversationId)
      const replay = projectCanonicalReplay({
        document: canonicalHistory,
        fallbackMessages: prompt.messages,
        messages: input.startInput.messages,
        modelId: input.startInput.modelId,
        options: promptOptions,
        providerId: input.startInput.providerId,
      })
      modelMessages = replay.messages
      freshnessRevision = replay.freshnessRevision
      replayFidelity = replay.fidelity === 'exact' ? 'exact' : 'migrated_legacy'
    }

    const anchorUserMessageId = [...input.startInput.messages].reverse()
      .find((message) => message.role === 'user')?.id ?? null
    const cacheKey = derivePromptCacheKey({
      cacheScopeId: input.startInput.cacheScopeId?.trim() || conversationId || 'ephemeral',
      contextFingerprint,
      modelId: input.startInput.modelId,
      providerId: input.startInput.providerId,
    })
    const responseMessages: ModelMessage[] = []

    if (conversationId) {
      await safelyPersistHistory(() => recordRunStarted({
        anchorUserMessageId,
        contextFingerprint,
        conversationId,
        fidelity: replayFidelity,
        initialMessages: modelMessages,
        modelId: input.startInput.modelId,
        providerId: input.startInput.providerId,
        runId,
      }))
      runWasRecorded = true
    }

    const stream = await input.createStream({
      cacheKey,
      messages: modelMessages,
      model: input.startInput.modelId,
      reasoningEffort: input.startInput.reasoningEffort,
      signal: input.abortController.signal,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      maxSteps: MAX_TOOL_STEPS,
      system: prompt.system,
      tools,
      onStepEnd: (step) => {
        responseMessages.push(...step.responseMessages as ModelMessage[])
        if (conversationId) {
          queueHistoryWrite(() => recordStepCompleted(conversationId, runId, step))
        }
      },
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
        const argumentsText = stringifyToolArguments(part.input ?? part.args)
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
          argumentsText: stringifyToolArguments(part.input ?? part.args),
          startedAt: Date.now(),
          toolName: part.toolName,
        }
        const completedAt = Date.now()
        const toolName = part.toolName
        const normalizedResult = normalizeToolExecutionResult(toolName, part.output ?? part.result)
        if (conversationId) {
          queueHistoryWrite(() => recordToolFreshness({
            conversationId,
            status: normalizedResult.status,
            subject: normalizedResult.subject,
            toolName,
          }))
        }
        const syntheticMessage = createSyntheticToolMessage(
          part.toolCallId,
          part.toolName,
          part.input ?? part.args,
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
          part.input ?? part.args,
          completedAt,
          {
            body: errorMessage,
            status: 'error',
            summary: errorMessage,
          },
        )

        invocationStateById.delete(part.toolCallId)
        emitChatStreamEvent(input.webContents, {
          argumentsText: currentState?.argumentsText ?? stringifyToolArguments(part.input ?? part.args),
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
      if (conversationId && runWasRecorded) {
        await safelyPersistHistory(() => recordRunTerminal(
          conversationId,
          runId,
          'run_failed',
          `tool-step-limit:${MAX_TOOL_STEPS}`,
        ))
        runWasRecorded = false
      }
      emitChatStreamEvent(input.webContents, {
        errorMessage: `The assistant hit the tool-step limit (${MAX_TOOL_STEPS}) before finishing. Increase the limit or continue the task in a follow-up turn.`,
        streamId: input.streamId,
        type: 'error',
      })
      return
    }

    if (conversationId) {
      await queuedHistoryWrites
      const finalDocument = await readCanonicalHistory(conversationId)
      await safelyPersistHistory(() => recordRunCompleted({
        anchorUserMessageId,
        contextFingerprint,
        conversationId,
        freshnessRevision: finalDocument.freshness.revision || freshnessRevision,
        fidelity: replayFidelity,
        messages: [...modelMessages, ...responseMessages],
        modelId: input.startInput.modelId,
        providerId: input.startInput.providerId,
        runId,
      }))
      runWasRecorded = false
    }

    emitChatStreamEvent(input.webContents, {
      streamId: input.streamId,
      type: 'completed',
    })
  } catch (error) {
    await queuedHistoryWrites
    if (conversationId && runWasRecorded) {
      await safelyPersistHistory(() => recordRunTerminal(
        conversationId,
        runId,
        input.abortController.signal.aborted ? 'run_aborted' : 'run_failed',
        error instanceof Error ? error.message : String(error),
      ))
    }
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
    const checkpointId = resolveActiveCheckpointId(input.startInput.messages)
    if (checkpointId && input.startInput.agentContextRootPath) {
      await captureWorkspaceCheckpointTerminalPostState(checkpointId, input.startInput.agentContextRootPath).catch(() => undefined)
    }
    input.onSettled?.()
  }
}
