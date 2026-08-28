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
  ContextUsageEstimate,
  ChatStreamCancellation,
  Message,
  StartChatStreamInput,
} from '../../../src/types/chat'
import { approximateTokenCount } from '../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings } from '../../../src/lib/contextCompactionSettings'
import { getLatestCompletedPlanPresentation } from '../../../src/lib/planPresentation'
import { getStoredSettings } from '../../settings/store'
import { listEnabledSkills } from '../../skills/service'
import { buildPromptContextManifest } from '../cache/canonicalization'
import { applyPromptCacheBreakpoints, derivePromptCacheKey } from '../cache/providerPolicies'
import type { ProviderStepRecord } from '../history/contracts'
import {
  readCanonicalHistory,
  recordCompactionCommitted,
  recordContextEpoch,
  recordRunCompleted,
  recordRunStarted,
  recordRunTerminal,
  recordStepCompleted,
  synchronizeCanonicalMessages,
} from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { applyWorkspaceInstructionsContext } from './prompts/workspaceInstructions'
import { compactModelMessages } from './compaction/service'
import {
  resolveAutomaticCompactionMessages,
  resolveAutomaticCompactionTrigger,
} from './compaction/automatic'
import { assertCompactionGate } from './compaction/gate'
import {
  calculateModelMessagesContextState,
  resolveRetainedContextTokens,
  shouldCompactContext,
} from './compaction/budget'
import type { CompactionPacket } from './compaction/contracts'
import {
  buildChatPrompt,
  hasImageAttachmentsInModelMessages,
  stripImageAttachmentsFromModelMessages,
} from './messages'
import { isUnsupportedImageInputError, resolveModelImageInputSupport } from './modelImageSupport'
import { appendStoredMessages } from '../../history/store'
import { createAgentToolBundle } from './tools'
import type { CodeModeExecutor } from './codeMode/executor'
import { createCodeModeToolCallRepair } from './codeMode/toolCallRepair'
import { createTerminalSessionOwner, releaseTerminalToolStateForTurn } from './tools/terminalToolShared'
import { getTerminalBroker } from '../../terminal/broker/instance'
import { sortToolSet } from './runtimeToolSet'
import { continueToolLoopUntilModelStops } from './toolLoopPolicy'
import { normalizeWorkspacePath } from '../../workspace/paths'
import {
  emitChatStreamEvent,
  processRuntimeStream,
  type ChatStreamEventTarget,
  type RuntimeStreamPart,
} from './runtimeStreamEvents'
import {
  withCanonicalToolModelOutputs,
} from './toolReplay'
import type { ChatStreamSteeringController } from './streamSteering'
import {
  buildSameTurnSteerModelMessages,
  createSameTurnSteerMessages,
  hasCompletedToolBoundary,
} from './runtimeSteering'
import { runProviderToolContinuationLoop } from './runtimeToolContinuation'

export { estimateToolEnabledContextUsage } from './runtimeContextUsage'

interface RuntimePromptOptions {
  includeAssistantReasoningParts?: boolean
  includeImageAttachments?: boolean
}

function resolveStreamCancellation(signal: AbortSignal): ChatStreamCancellation {
  const reason = signal.reason
  if (reason && typeof reason === 'object') {
    const candidate = reason as Partial<ChatStreamCancellation>
    if (
      typeof candidate.reason === 'string'
      && typeof candidate.surface === 'string'
      && typeof candidate.policy === 'string'
      && typeof candidate.requestedAt === 'number'
    ) {
      return candidate as ChatStreamCancellation
    }
  }
  return {
    policy: 'terminate',
    reason: 'unknown',
    requestedAt: Date.now(),
    surface: 'system',
  }
}

export interface ProviderStreamFactoryInput {
  cacheKey: string
  maxOutputTokens?: number
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


async function safelyPersistHistory(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    console.error('Canonical chat history persistence failed.', error)
  }
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


export async function runToolEnabledChatStream(input: {
  abortController: AbortController
  createStream: ProviderStreamFactory
  promptOptions?: RuntimePromptOptions
  startInput: StartChatStreamInput
  steering: ChatStreamSteeringController
  streamId: string
  webContents: WebContents | ChatStreamEventTarget
}) {
  const contextCompaction = normalizeContextCompactionSettings(input.startInput.contextCompaction)
  const runId = randomUUID()
  const conversationId = input.startInput.conversationId?.trim() || null
  let workspaceRootPath: string | null = null
  let codeModeExecutor: CodeModeExecutor | null = null
  let terminalOwner: WebContents | null = null
  let runWasRecorded = false
  let terminalOutcome: 'completed' | 'failed' = 'failed'
  let queuedHistoryWrites = Promise.resolve()
  const queueHistoryWrite = (action: () => Promise<unknown>) => {
    queuedHistoryWrites = queuedHistoryWrites.then(() => safelyPersistHistory(action))
  }

  try {
    workspaceRootPath = normalizeWorkspacePath(input.startInput.agentContextRootPath)
    terminalOwner = createTerminalSessionOwner(input.webContents)
    const enabledSkills = await listEnabledSkills(workspaceRootPath)
    const activePlanPath = getLatestCompletedPlanPresentation(input.startInput.messages)?.relativePath ?? null
    const orchestrationMode = 'code_mode' as const
    const toolBundle = await createAgentToolBundle(
      {
        checkpointId: resolveActiveCheckpointId(input.startInput.messages),
        conversationId: input.startInput.conversationId ?? null,
        turnId: runId,
        workspaceRootPath,
        terminalExecutionMode: input.startInput.terminalExecutionMode,
        webContents: terminalOwner,
      },
      {
        activePlanPath,
        chatMode: input.startInput.chatMode,
        enabledSkills,
        orchestrationMode,
        providerId: input.startInput.providerId,
      },
    )
    codeModeExecutor = toolBundle.codeModeExecutor
    const rawTools = toolBundle.tools
    const tools = applyPromptCacheBreakpoints(
      withCanonicalToolModelOutputs(sortToolSet(rawTools)),
      input.startInput.providerId,
    )
    const promptOptions = {
      ...input.promptOptions,
      includeImageAttachments: await resolveModelImageInputSupport(
        input.startInput.providerId,
        input.startInput.modelId,
      ),
      orchestrationMode,
      terminalExecutionMode: input.startInput.terminalExecutionMode,
    }
    const prompt = buildChatPrompt({
      chatMode: input.startInput.chatMode,
      messages: input.startInput.messages,
      options: promptOptions,
      workspaceRootPath,
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
    let replayCompactionPacket: CompactionPacket | null = null

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
      replayCompactionPacket = replay.compactionPacket
    }
    if (!promptOptions.includeImageAttachments) {
      modelMessages = stripImageAttachmentsFromModelMessages(modelMessages)
    }
    modelMessages = applyWorkspaceInstructionsContext(modelMessages, workspaceRootPath)

    const anchorUserMessageId = [...input.startInput.messages].reverse()
      .find((message) => message.role === 'user')?.id ?? null
    let replayAnchorUserMessageId = anchorUserMessageId
    const cacheKey = derivePromptCacheKey({
      cacheScopeId: input.startInput.cacheScopeId?.trim() || conversationId || 'ephemeral',
      contextFingerprint,
      modelId: input.startInput.modelId,
      providerId: input.startInput.providerId,
    })
    let replayMessages: ModelMessage[] = [...modelMessages]
    let latestCompactionPacket: CompactionPacket | null = replayCompactionPacket
    let nextRecordedStepNumber = 0
    let restartingAfterToolBoundary = false
    const systemPromptTokens = approximateTokenCount(prompt.system)
    const emitContextUsage = (usage: ContextUsageEstimate) => {
      if (!conversationId) return
      emitChatStreamEvent(input.webContents, {
        conversationId,
        streamId: input.streamId,
        type: 'context_usage_updated',
        usage,
      })
    }

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

    let shouldStripImageAttachments = promptOptions.includeImageAttachments === false
    const createProviderStream = async (streamInput: ProviderStreamFactoryInput) => {
      const providerMessages = shouldStripImageAttachments
        ? stripImageAttachmentsFromModelMessages(streamInput.messages)
        : streamInput.messages

      try {
        return await input.createStream({
          ...streamInput,
          messages: providerMessages,
        })
      } catch (error) {
        if (
          shouldStripImageAttachments ||
          !hasImageAttachmentsInModelMessages(streamInput.messages) ||
          !isUnsupportedImageInputError(error)
        ) {
          throw error
        }

        shouldStripImageAttachments = true
        return input.createStream({
          ...streamInput,
          messages: stripImageAttachmentsFromModelMessages(streamInput.messages),
        })
      }
    }

    const initialStreamInput: ProviderStreamFactoryInput = {
      cacheKey,
      messages: modelMessages,
      model: input.startInput.modelId,
      reasoningEffort: input.startInput.reasoningEffort,
      repairToolCall: createCodeModeToolCallRepair(toolBundle.registry),
      signal: input.abortController.signal,
      stopWhen: continueToolLoopUntilModelStops,
      system: prompt.system,
      tools,
      onStepEnd: (step) => {
        const recordedStep = {
          ...step,
          stepNumber: nextRecordedStepNumber,
        }
        nextRecordedStepNumber += 1
        replayMessages = [
          ...replayMessages,
          ...(recordedStep.responseMessages as ModelMessage[]),
        ]
        if (conversationId) {
          queueHistoryWrite(() => recordStepCompleted(conversationId, runId, recordedStep))
        }
      },
      prepareStep: async (stepInput) => {
        // A provider continuation starts a fresh AI SDK stream whose local step
        // number resets to zero. Keep TideCode's logical step number monotonic
        // so compaction still sees this as the next tool/model boundary.
        const logicalStepNumber = nextRecordedStepNumber
        const queuedSteerMessages = (
          hasCompletedToolBoundary(stepInput.steps)
          || (restartingAfterToolBoundary && stepInput.stepNumber === 0)
        )
          ? input.steering.consumePendingAtToolBoundary()
          : []
        const consumedSteerMessages = createSameTurnSteerMessages(
          queuedSteerMessages,
          input.startInput,
        )
        const consumedSteerModelMessages = buildSameTurnSteerModelMessages(
          consumedSteerMessages,
          promptOptions,
        )
        const currentStepMessages = consumedSteerModelMessages.length > 0
          ? [...stepInput.messages, ...consumedSteerModelMessages]
          : stepInput.messages
        const compactionMessages = resolveAutomaticCompactionMessages({
          messages: currentStepMessages,
          responseMessages: stepInput.responseMessages,
        })

        if (consumedSteerMessages.length > 0) {
          replayAnchorUserMessageId = consumedSteerMessages.at(-1)?.id ?? replayAnchorUserMessageId
          if (conversationId) {
            await appendStoredMessages({
              chatMode: input.startInput.chatMode,
              conversationId,
              messages: consumedSteerMessages,
            })
          }
          replayMessages.push(...consumedSteerModelMessages)
          emitChatStreamEvent(input.webContents, {
            messages: consumedSteerMessages,
            streamId: input.streamId,
            type: 'steer_messages_consumed',
          })
        }

        const automaticTrigger = resolveAutomaticCompactionTrigger({
          abortSignal: input.abortController.signal,
          messages: compactionMessages,
          responseMessages: stepInput.responseMessages,
          stepNumber: logicalStepNumber,
        })
        if (!automaticTrigger) {
          return consumedSteerModelMessages.length > 0
            ? { messages: currentStepMessages }
            : undefined
        }

        const liveContextCompaction = await getStoredSettings()
          .then((settings) => normalizeContextCompactionSettings(settings.contextCompaction))
          .catch(() => contextCompaction)

        const compactionBudgetInput = {
          contextWindowTokens: liveContextCompaction.contextWindowTokens,
          messages: compactionMessages,
          systemPromptTokens,
          toolSchemaTokens: promptContext.toolSchemaTokens,
          triggerRatio: liveContextCompaction.triggerPercent / 100,
        }
        const compactionContextState = calculateModelMessagesContextState(compactionBudgetInput)
        const compactionBudget = compactionContextState.budget
        emitContextUsage(compactionContextState.usage)
        const retainedContextTokens = resolveRetainedContextTokens(
          liveContextCompaction.retainedContextTokens,
          compactionBudget,
        )
        // Crossing the configured threshold is itself the requirement. Window
        // selection decides how to compact, including an oversized current
        // turn, but it must never downgrade an over-threshold context to
        // optional and let the next provider step continue uncompressed.
        const compactionRequired = shouldCompactContext(compactionBudget)

        const compactionAttemptId = randomUUID()
        let compactionStarted = false
        const emitCompactionFailed = (reason: 'aborted' | 'error' | 'unavailable') => {
          if (!conversationId || !compactionStarted) return
          emitChatStreamEvent(input.webContents, {
            attemptId: compactionAttemptId,
            conversationId,
            reason,
            streamId: input.streamId,
            type: 'compaction_failed',
          })
        }

        let compacted: Awaited<ReturnType<typeof compactModelMessages>>
        try {
          compacted = await compactModelMessages({
            createStream: (compactionInput) => createProviderStream({
              cacheKey: `${cacheKey}:compaction`,
              maxOutputTokens: compactionInput.maxOutputTokens,
              messages: compactionInput.messages,
              model: compactionInput.model,
              reasoningEffort: compactionInput.reasoningEffort as StartChatStreamInput['reasoningEffort'],
              signal: compactionInput.signal,
              stopWhen: stepCountIs(1),
              maxSteps: 1,
              system: compactionInput.system,
              tools: {},
            }),
            messages: compactionMessages,
            model: input.startInput.modelId,
            providerId: input.startInput.providerId,
            onStarted: () => {
              compactionStarted = true
              if (!conversationId) return
              emitChatStreamEvent(input.webContents, {
                attemptId: compactionAttemptId,
                conversationId,
                streamId: input.streamId,
                type: 'compaction_started',
              })
            },
            reasoningEffort: input.startInput.reasoningEffort,
            systemPromptTokens,
            toolSchemaTokens: promptContext.toolSchemaTokens,
            previousPacket: latestCompactionPacket,
            contextWindowTokens: liveContextCompaction.contextWindowTokens,
            retainedContextTokens,
            triggerRatio: liveContextCompaction.triggerPercent / 100,
            signal: input.abortController.signal,
            turnState: 'active',
          })
        } catch (error) {
          emitCompactionFailed('error')
          throw error
        }
        if (input.abortController.signal.aborted) {
          emitCompactionFailed('aborted')
          return consumedSteerModelMessages.length > 0
            ? { messages: currentStepMessages }
            : undefined
        }
        if (!compacted) {
          emitCompactionFailed('unavailable')
          assertCompactionGate({
            aborted: false,
            compactionResult: null,
            projectedBudget: null,
            required: compactionRequired,
          })
          return consumedSteerModelMessages.length > 0
            ? { messages: currentStepMessages }
            : undefined
        }

        const projectedContextState = calculateModelMessagesContextState({
          ...compactionBudgetInput,
          messages: compacted.projectedMessages,
        })
        const projectedBudget = projectedContextState.budget
        assertCompactionGate({
          aborted: false,
          compactionResult: compacted,
          projectedBudget,
          required: compactionRequired,
        })

        replayMessages = [...compacted.projectedMessages]
        latestCompactionPacket = compacted.packet
        if (conversationId) {
          await safelyPersistHistory(() => recordCompactionCommitted({
            anchorUserMessageId: replayAnchorUserMessageId,
            compactionId: compacted.packet.packetId,
            conversationId,
            contextFingerprint,
            modelId: input.startInput.modelId,
            packet: compacted.packet,
            projectedMessages: compacted.projectedMessages,
            providerId: input.startInput.providerId,
            projectionVersion: compacted.projectionVersion,
            reasoningRetention: compacted.reasoningRetention,
            parentPacketId: compacted.packet.parentPacketId,
            sourceDigest: compacted.sourceDigest,
            sourceMessageIds: compacted.packet.sourceMessageIds,
          }))
          emitChatStreamEvent(input.webContents, {
            compactionId: compacted.packet.packetId,
            conversationId,
            streamId: input.streamId,
            type: 'compaction_committed',
          })
        }
        emitContextUsage(projectedContextState.usage)
        return {
          messages: compacted.projectedMessages,
        }
      },
    }
    let hasEmittedStarted = false
    const processProviderStreamInput = async (
      streamInput: ProviderStreamFactoryInput,
      continuationIndex: number,
    ) => {
      restartingAfterToolBoundary = continuationIndex > 0
      let streamLastStep: ProviderStepRecord | null = null
      const providerStreamInput: ProviderStreamFactoryInput = {
        ...streamInput,
        onStepEnd: async (step) => {
          streamLastStep = step
          await streamInput.onStepEnd?.(step)
        },
      }
      let stream = await createProviderStream(providerStreamInput)
      if (!hasEmittedStarted) {
        emitChatStreamEvent(input.webContents, {
          streamId: input.streamId,
          type: 'started',
        })
        hasEmittedStarted = true
      }

      try {
        const result = await processRuntimeStream({
          abortController: input.abortController,
          conversationId,
          fullStream: stream.fullStream,
          queueHistoryWrite,
          streamId: input.streamId,
          webContents: input.webContents,
        })
        return { ...result, lastStep: streamLastStep }
      } catch (error) {
        if (
          shouldStripImageAttachments ||
          !hasImageAttachmentsInModelMessages(streamInput.messages) ||
          !isUnsupportedImageInputError(error)
        ) {
          throw error
        }
        shouldStripImageAttachments = true
        const imageRetryMessages = stripImageAttachmentsFromModelMessages(streamInput.messages)
        streamLastStep = null
        stream = await createProviderStream({
          ...providerStreamInput,
          messages: imageRetryMessages,
        })
        const result = await processRuntimeStream({
          abortController: input.abortController,
          conversationId,
          fullStream: stream.fullStream,
          queueHistoryWrite,
          streamId: input.streamId,
          webContents: input.webContents,
        })
        return { ...result, lastStep: streamLastStep }
      }
    }

    const processedStream = await runProviderToolContinuationLoop({
      getContinuationMessages: () => replayMessages,
      initialInput: initialStreamInput,
      run: processProviderStreamInput,
    })
    restartingAfterToolBoundary = false

    // Some providers close their async iterable normally after receiving an
    // abort signal instead of throwing an AbortError. Treat that close as an
    // abort before the normal completion path can update canonical replay or
    // emit a completed event.
    if (processedStream.wasAborted || input.abortController.signal.aborted) {
      throw new Error('Chat stream aborted.')
    }

    // A run can end immediately after a completed tool call. In that case the
    // provider never asks for another model step, so prepareStep has no chance
    // to install the compacted projection. Do one final AI-only compaction pass
    // before committing the completed replay so a finished turn cannot leave
    // the active canonical context over the configured threshold.
    if (conversationId) {
      const finalContextCompaction = await getStoredSettings()
        .then((settings) => normalizeContextCompactionSettings(settings.contextCompaction))
        .catch(() => contextCompaction)
      // Use the same provider-facing replay that ContextIndicator estimates.
      // The compaction prompt applies its own bounded tool-output formatting;
      // truncating here would make the threshold disagree with the indicator.
      const finalCompactionMessages = replayMessages
      const finalCompactionBudgetInput = {
        contextWindowTokens: finalContextCompaction.contextWindowTokens,
        messages: finalCompactionMessages,
        systemPromptTokens,
        toolSchemaTokens: promptContext.toolSchemaTokens,
        triggerRatio: finalContextCompaction.triggerPercent / 100,
      }
      const finalContextState = calculateModelMessagesContextState(finalCompactionBudgetInput)
      const finalCompactionBudget = finalContextState.budget
      emitContextUsage(finalContextState.usage)
      const finalRetainedContextTokens = resolveRetainedContextTokens(
        finalContextCompaction.retainedContextTokens,
        finalCompactionBudget,
      )
      const finalCompactionRequired = shouldCompactContext(finalCompactionBudget)

      if (finalCompactionRequired) {
        const compactionAttemptId = randomUUID()
        let compactionStarted = false
        const emitFinalCompactionFailed = (reason: 'aborted' | 'error' | 'unavailable') => {
          if (!compactionStarted) return
          emitChatStreamEvent(input.webContents, {
            attemptId: compactionAttemptId,
            conversationId,
            reason,
            streamId: input.streamId,
            type: 'compaction_failed',
          })
        }

        try {
          const compacted = await compactModelMessages({
            createStream: (compactionInput) => createProviderStream({
              cacheKey: `${cacheKey}:compaction:final`,
              maxOutputTokens: compactionInput.maxOutputTokens,
              messages: compactionInput.messages,
              model: compactionInput.model,
              reasoningEffort: compactionInput.reasoningEffort as StartChatStreamInput['reasoningEffort'],
              signal: compactionInput.signal,
              stopWhen: stepCountIs(1),
              maxSteps: 1,
              system: compactionInput.system,
              tools: {},
            }),
            messages: finalCompactionMessages,
            model: input.startInput.modelId,
            providerId: input.startInput.providerId,
            onStarted: () => {
              compactionStarted = true
              emitChatStreamEvent(input.webContents, {
                attemptId: compactionAttemptId,
                conversationId,
                streamId: input.streamId,
                type: 'compaction_started',
              })
            },
            reasoningEffort: input.startInput.reasoningEffort,
            systemPromptTokens,
            toolSchemaTokens: promptContext.toolSchemaTokens,
            previousPacket: latestCompactionPacket,
            contextWindowTokens: finalContextCompaction.contextWindowTokens,
            retainedContextTokens: finalRetainedContextTokens,
            triggerRatio: finalContextCompaction.triggerPercent / 100,
            signal: input.abortController.signal,
            turnState: 'settled',
          })

          if (input.abortController.signal.aborted) {
            emitFinalCompactionFailed('aborted')
          } else if (!compacted) {
            emitFinalCompactionFailed('unavailable')
          } else {
            const projectedFinalContextState = calculateModelMessagesContextState({
              ...finalCompactionBudgetInput,
              messages: compacted.projectedMessages,
            })
            replayMessages = [...compacted.projectedMessages]
            latestCompactionPacket = compacted.packet
            await safelyPersistHistory(() => recordCompactionCommitted({
              anchorUserMessageId: replayAnchorUserMessageId,
              compactionId: compacted.packet.packetId,
              conversationId,
              contextFingerprint,
              modelId: input.startInput.modelId,
              packet: compacted.packet,
              projectedMessages: compacted.projectedMessages,
              providerId: input.startInput.providerId,
              projectionVersion: compacted.projectionVersion,
              reasoningRetention: compacted.reasoningRetention,
              parentPacketId: compacted.packet.parentPacketId,
              sourceDigest: compacted.sourceDigest,
              sourceMessageIds: compacted.packet.sourceMessageIds,
            }))
            emitChatStreamEvent(input.webContents, {
              compactionId: compacted.packet.packetId,
              conversationId,
              streamId: input.streamId,
              type: 'compaction_committed',
            })
            emitContextUsage(projectedFinalContextState.usage)
          }
        } catch (error) {
          emitFinalCompactionFailed(input.abortController.signal.aborted ? 'aborted' : 'error')
          console.error('Final AI compaction failed; preserving the completed run.', error)
        }
      }
    }

    if (conversationId) {
      await queuedHistoryWrites
      if (input.abortController.signal.aborted) {
        throw new Error('Chat stream aborted.')
      }

      const finalDocument = await readCanonicalHistory(conversationId)
      if (input.abortController.signal.aborted) {
        throw new Error('Chat stream aborted.')
      }

      await safelyPersistHistory(() => recordRunCompleted({
        anchorUserMessageId: replayAnchorUserMessageId,
        compactionId: latestCompactionPacket?.packetId ?? null,
        contextFingerprint,
        conversationId,
        freshnessRevision: finalDocument.freshness.revision || freshnessRevision,
        fidelity: replayFidelity,
        messages: replayMessages,
        modelId: input.startInput.modelId,
        providerId: input.startInput.providerId,
        runId,
      }))

      // Cancellation can arrive while the completion write is flushing. Keep
      // the frontend terminal event consistent with the user's stop action
      // and leave the run eligible for an aborted terminal record.
      if (input.abortController.signal.aborted) {
        throw new Error('Chat stream aborted.')
      }

      runWasRecorded = false
    }

    if (input.abortController.signal.aborted) {
      throw new Error('Chat stream aborted.')
    }

    emitChatStreamEvent(input.webContents, {
      conversationId,
      streamId: input.streamId,
      type: 'completed',
    })
    terminalOutcome = 'completed'
  } catch (error) {
    await queuedHistoryWrites
    if (conversationId && runWasRecorded) {
      const cancellation = input.abortController.signal.aborted
        ? resolveStreamCancellation(input.abortController.signal)
        : undefined
      await safelyPersistHistory(() => recordRunTerminal(
        conversationId,
        runId,
        input.abortController.signal.aborted ? 'run_aborted' : 'run_failed',
        error instanceof Error ? error.message : String(error),
        cancellation,
      ))
    }
    if (input.abortController.signal.aborted) {
      emitChatStreamEvent(input.webContents, {
        conversationId,
        streamId: input.streamId,
        type: 'aborted',
      })
    } else {
      emitChatStreamEvent(input.webContents, {
        errorMessage: error instanceof Error && error.message.trim().length > 0 ? error.message : 'Chat request failed.',
        conversationId,
        streamId: input.streamId,
        type: 'error',
      })
    }
  } finally {
    if (workspaceRootPath) {
      const cancellation = input.abortController.signal.aborted
        ? resolveStreamCancellation(input.abortController.signal)
        : terminalOutcome === 'completed'
          ? {
              policy: 'terminate' as const,
              reason: 'run_completed' as const,
              requestedAt: Date.now(),
              surface: 'system' as const,
            }
          : {
              policy: 'terminate_after_grace' as const,
              reason: 'provider_failure' as const,
              requestedAt: Date.now(),
              surface: 'system' as const,
            }
      await getTerminalBroker().applyRunCancellation(runId, {
        ...cancellation,
        conversationId,
        runId,
      }).catch(() => undefined)
      releaseTerminalToolStateForTurn(runId)
    }
    await codeModeExecutor?.dispose().catch(() => undefined)
  }
}
