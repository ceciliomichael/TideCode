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
  Message,
  StartChatStreamInput,
} from '../../../src/types/chat'
import { approximateTokenCount } from '../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings } from '../../../src/lib/contextCompactionSettings'
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
import { hasCompactionEligibleHistory } from './compaction/window'
import {
  buildChatPrompt,
  ensureCurrentExecutionModeContext,
  hasImageAttachmentsInModelMessages,
  stripImageAttachmentsFromModelMessages,
} from './messages'
import { isUnsupportedImageInputError, resolveModelImageInputSupport } from './modelImageSupport'
import { appendStoredMessages } from '../../history/store'
import { createAgentToolBundle } from './tools'
import type { CodeModeExecutor } from './codeMode/executor'
import { terminateAllBackgroundSessionsForTurn } from './tools/terminalTools'
import { createTerminalSessionOwner } from './tools/terminalToolShared'
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

export { estimateToolEnabledContextUsage } from './runtimeContextUsage'

interface RuntimePromptOptions {
  includeAssistantReasoningParts?: boolean
  includeImageAttachments?: boolean
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
  let queuedHistoryWrites = Promise.resolve()
  const queueHistoryWrite = (action: () => Promise<unknown>) => {
    queuedHistoryWrites = queuedHistoryWrites.then(() => safelyPersistHistory(action))
  }

  try {
    workspaceRootPath = normalizeWorkspacePath(input.startInput.agentContextRootPath)
    terminalOwner = createTerminalSessionOwner(input.webContents)
    const enabledSkills = await listEnabledSkills(workspaceRootPath)
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
    modelMessages = ensureCurrentExecutionModeContext(
      modelMessages,
      input.startInput.terminalExecutionMode,
    )
    if (!promptOptions.includeImageAttachments) {
      modelMessages = stripImageAttachmentsFromModelMessages(modelMessages)
    }

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
      signal: input.abortController.signal,
      stopWhen: continueToolLoopUntilModelStops,
      system: prompt.system,
      tools,
      onStepEnd: (step) => {
        replayMessages.push(...step.responseMessages as ModelMessage[])
        if (conversationId) {
          queueHistoryWrite(() => recordStepCompleted(conversationId, runId, step))
        }
      },
      prepareStep: async (stepInput) => {
        const queuedSteerMessages = hasCompletedToolBoundary(stepInput.steps)
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
          stepNumber: stepInput.stepNumber,
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
        const compactionRequired = shouldCompactContext(compactionBudget) &&
          hasCompactionEligibleHistory(compactionMessages, {
            previousPacket: latestCompactionPacket,
            retainedContextTokens,
          })

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
    let stream = await createProviderStream(initialStreamInput)

    emitChatStreamEvent(input.webContents, {
      streamId: input.streamId,
      type: 'started',
    })

    let processedStream: Awaited<ReturnType<typeof processRuntimeStream>>
    try {
      processedStream = await processRuntimeStream({
        abortController: input.abortController,
        conversationId,
        fullStream: stream.fullStream,
        queueHistoryWrite,
        streamId: input.streamId,
        webContents: input.webContents,
      })
    } catch (error) {
      if (
        shouldStripImageAttachments ||
        !hasImageAttachmentsInModelMessages(initialStreamInput.messages) ||
        !isUnsupportedImageInputError(error)
      ) {
        throw error
      }

      shouldStripImageAttachments = true
      stream = await createProviderStream(initialStreamInput)
      processedStream = await processRuntimeStream({
        abortController: input.abortController,
        conversationId,
        fullStream: stream.fullStream,
        queueHistoryWrite,
        streamId: input.streamId,
        webContents: input.webContents,
      })
    }

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
      const finalCompactionRequired = shouldCompactContext(finalCompactionBudget) &&
        hasCompactionEligibleHistory(finalCompactionMessages, {
        previousPacket: latestCompactionPacket,
        retainedContextTokens: finalRetainedContextTokens,
      })

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
      await terminateAllBackgroundSessionsForTurn(
        terminalOwner ?? input.webContents,
        workspaceRootPath,
        runId,
      ).catch(() => undefined)
    }
    await codeModeExecutor?.dispose().catch(() => undefined)
  }
}
