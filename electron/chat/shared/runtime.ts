import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import {
  stepCountIs,
  type PrepareStepFunction,
  type ModelMessage,
  type StopCondition,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai'
import type {
  ChatStreamEvent,
  ContextUsageEstimate,
  Message,
  StartChatStreamInput,
  ToolInvocationResultPresentation,
} from '../../../src/types/chat'
import { approximateTokenCount, estimateModelMessageContextUsage } from '../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings } from '../../../src/lib/contextCompactionSettings'
import { buildSkillsSystemPromptBlock, listEnabledSkills } from '../../skills/service'
import { buildPromptContextManifest, describeTools, stableStringify } from '../cache/canonicalization'
import { derivePromptCacheKey } from '../cache/providerPolicies'
import type { ProviderStepRecord } from '../history/contracts'
import {
  readCanonicalHistory,
  recordCompactionCommitted,
  recordContextEpoch,
  recordRunCompleted,
  recordRunStarted,
  recordRunTerminal,
  recordStepCompleted,
  recordToolFreshness,
  synchronizeCanonicalMessages,
} from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { compactModelMessages } from './compaction/service'
import { findLatestCompactionPacket } from './compaction/window'
import {
  buildChatPrompt,
  ensureCurrentExecutionModeContext,
} from './messages'
import {
  createAgentTools,
  getDynamicToolInvocationProjection,
  repairDirectDynamicToolCall,
} from './tools'
import { cleanUpFinishedSessionsAtTurnEnd } from './tools/terminalTools'
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
  repairToolCall?: ToolCallRepairFunction<ToolSet>
  system: string
  tools: ToolSet
  onStepEnd?: (step: ProviderStepRecord) => void | Promise<void>
  prepareStep?: PrepareStepFunction<ToolSet>
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

function parseToolArguments(input: string) {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

function resolveDisplayedInvocation(toolName: string, input: unknown, result?: unknown) {
  return getDynamicToolInvocationProjection(toolName, input, result) ?? {
    argumentsValue: input,
    toolName,
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
    availableSkillsBlock: buildSkillsSystemPromptBlock(),
    includeAssistantReasoningParts: input.providerId === 'openai',
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
    modelMessages = projectCanonicalReplay({
      document: canonicalHistory,
      fallbackMessages: prompt.messages,
      messages: input.messages,
      modelId: input.modelId.trim(),
      options: promptOptions,
      providerId: input.providerId,
    }).messages
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
    toolSchemaTokens = approximateTokenCount(stableStringify(describeTools(sortToolSet(tools))))
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

export async function runToolEnabledChatStream(input: {
  abortController: AbortController
  createStream: ProviderStreamFactory
  onSettled?: () => void
  promptOptions?: RuntimePromptOptions
  startInput: StartChatStreamInput
  streamId: string
  webContents: WebContents
}) {
  const contextCompaction = normalizeContextCompactionSettings(input.startInput.contextCompaction)
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
    modelMessages = ensureCurrentExecutionModeContext(
      modelMessages,
      input.startInput.terminalExecutionMode,
    )

    const anchorUserMessageId = [...input.startInput.messages].reverse()
      .find((message) => message.role === 'user')?.id ?? null
    const cacheKey = derivePromptCacheKey({
      cacheScopeId: input.startInput.cacheScopeId?.trim() || conversationId || 'ephemeral',
      contextFingerprint,
      modelId: input.startInput.modelId,
      providerId: input.startInput.providerId,
    })
    let replayMessages: ModelMessage[] = [...modelMessages]
    let latestCompactionPacket = findLatestCompactionPacket(modelMessages)

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
      repairToolCall: repairDirectDynamicToolCall,
      system: prompt.system,
      tools,
      onStepEnd: (step) => {
        replayMessages.push(...step.responseMessages as ModelMessage[])
        if (conversationId) {
          queueHistoryWrite(() => recordStepCompleted(conversationId, runId, step))
        }
      },
      prepareStep: async (stepInput) => {
        const compacted = await compactModelMessages({
          createStream: (compactionInput) => input.createStream({
            cacheKey: `${cacheKey}:compaction`,
            messages: compactionInput.messages,
            model: compactionInput.model,
            reasoningEffort: compactionInput.reasoningEffort as StartChatStreamInput['reasoningEffort'],
            signal: compactionInput.signal,
            stopWhen: stepCountIs(1),
            maxSteps: 1,
            system: compactionInput.system,
            tools: {},
          }),
          messages: stepInput.messages,
          model: input.startInput.modelId,
          reasoningEffort: input.startInput.reasoningEffort,
          systemPromptTokens: approximateTokenCount(prompt.system),
          toolSchemaTokens: promptContext.toolSchemaTokens,
          previousPacket: latestCompactionPacket,
          contextWindowTokens: contextCompaction.contextWindowTokens,
          reserveTokens: contextCompaction.reserveTokens,
          targetRatio: contextCompaction.targetPercent / 100,
          triggerRatio: contextCompaction.triggerPercent / 100,
          signal: input.abortController.signal,
        })
        if (!compacted) return undefined

        replayMessages = [...compacted.projectedMessages]
        latestCompactionPacket = compacted.packet
        if (conversationId) {
          await safelyPersistHistory(() => recordCompactionCommitted({
            anchorUserMessageId,
            compactionId: compacted.packet.packetId,
            conversationId,
            modelId: input.startInput.modelId,
            packet: compacted.packet,
            projectedMessages: compacted.projectedMessages,
            providerId: input.startInput.providerId,
            sourceDigest: compacted.sourceDigest,
            sourceMessageIds: compacted.packet.sourceMessageIds,
            usedFallback: compacted.usedFallback,
          }))
        }
        return {
          messages: compacted.projectedMessages,
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
        const displayedInvocation = resolveDisplayedInvocation(part.toolName, undefined)
        invocationStateById.set(part.id, {
          argumentsText: '',
          startedAt,
          toolName: displayedInvocation.toolName,
        })
        emitChatStreamEvent(input.webContents, {
          argumentsText: '',
          invocationId: part.id,
          startedAt,
          streamId: input.streamId,
          toolName: displayedInvocation.toolName,
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
        const outerToolName = typeof part.toolName === 'string' ? part.toolName : currentState.toolName
        const displayedInvocation = resolveDisplayedInvocation(outerToolName, parseToolArguments(nextArgumentsText))
        const displayedArgumentsText = displayedInvocation.toolName === outerToolName
          ? nextArgumentsText
          : stringifyToolArguments(displayedInvocation.argumentsValue)
        invocationStateById.set(part.id, {
          ...currentState,
          argumentsText: displayedArgumentsText,
          toolName: displayedInvocation.toolName,
        })
        emitChatStreamEvent(input.webContents, {
          argumentsText: displayedArgumentsText,
          invocationId: part.id,
          streamId: input.streamId,
          toolName: displayedInvocation.toolName,
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
        const displayedInvocation = resolveDisplayedInvocation(part.toolName, part.input ?? part.args)
        const argumentsText = stringifyToolArguments(displayedInvocation.argumentsValue)
        if (!currentState) {
          const startedAt = Date.now()
          invocationStateById.set(part.toolCallId, {
            argumentsText,
            startedAt,
            toolName: displayedInvocation.toolName,
          })
          emitChatStreamEvent(input.webContents, {
            argumentsText,
            invocationId: part.toolCallId,
            startedAt,
            streamId: input.streamId,
            toolName: displayedInvocation.toolName,
            type: 'tool_invocation_started',
          })
          continue
        }

        if (currentState.argumentsText !== argumentsText) {
          invocationStateById.set(part.toolCallId, {
            ...currentState,
            argumentsText,
            toolName: displayedInvocation.toolName,
          })
          emitChatStreamEvent(input.webContents, {
            argumentsText,
            invocationId: part.toolCallId,
            streamId: input.streamId,
            toolName: displayedInvocation.toolName,
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

        const completedAt = Date.now()
        const toolName = part.toolName
        const normalizedResult = normalizeToolExecutionResult(toolName, part.output ?? part.result)
        const displayedInvocation = resolveDisplayedInvocation(
          toolName,
          part.input ?? part.args,
          normalizedResult,
        )
        const displayedArgumentsText = stringifyToolArguments(displayedInvocation.argumentsValue)
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
        const displaySyntheticMessage = createSyntheticToolMessage(
          part.toolCallId,
          displayedInvocation.toolName,
          displayedInvocation.argumentsValue,
          completedAt,
          normalizedResult,
        )
        const payload = {
          argumentsText: displayedArgumentsText,
          completedAt,
          invocationId: part.toolCallId,
          resultContent: displaySyntheticMessage.content,
          ...(getToolResultPresentation(normalizedResult)
            ? { resultPresentation: getToolResultPresentation(normalizedResult) }
            : {}),
          streamId: input.streamId,
          syntheticMessage,
          toolName: displayedInvocation.toolName,
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
        const displayedInvocation = resolveDisplayedInvocation(part.toolName, part.input ?? part.args)
        const displayedArgumentsText = stringifyToolArguments(displayedInvocation.argumentsValue)
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
        const displaySyntheticMessage = createSyntheticToolMessage(
          part.toolCallId,
          displayedInvocation.toolName,
          displayedInvocation.argumentsValue,
          completedAt,
          {
            body: errorMessage,
            status: 'error',
            summary: errorMessage,
          },
        )

        invocationStateById.delete(part.toolCallId)
        emitChatStreamEvent(input.webContents, {
          argumentsText: currentState?.argumentsText ?? displayedArgumentsText,
          completedAt,
          errorMessage,
          invocationId: part.toolCallId,
          resultContent: displaySyntheticMessage.content,
          streamId: input.streamId,
          syntheticMessage,
          toolName: displayedInvocation.toolName,
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
        messages: replayMessages,
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
    if (input.startInput.agentContextRootPath) {
      await cleanUpFinishedSessionsAtTurnEnd(
        input.webContents,
        input.startInput.agentContextRootPath,
        conversationId,
      ).catch(() => undefined)
    }
    input.onSettled?.()
  }
}
