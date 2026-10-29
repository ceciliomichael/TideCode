import { randomUUID } from 'node:crypto'
import { StreamGenerationMetrics } from './streamGenerationMetrics'
import type { WebContents } from 'electron'
import {
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
  readLatestConversationMemory,
  recordCompactionCommitted,
  recordCompactionAttempt,
  captureCompactionSource,
  recordContextEpoch,
  recordRunCompleted,
  recordRunStarted,
  recordRunTerminal,
  recordStepCompleted,
  synchronizeCanonicalMessages,
} from '../history/eventStore'
import { projectCanonicalReplay } from '../history/replayProjector'
import { applyWorkspaceInstructionsContext } from './prompts/workspaceInstructions'
import { applyConversationMemoryContext, applyWorkspaceMemoryContext } from './memory/runtimeContext'
import { compactModelMessages } from './compaction/service'
import {
  resolveAutomaticCompactionMessages,
  resolveAutomaticCompactionTrigger,
} from './compaction/automatic'
import { CompactionError } from './compaction/gate'
import { coordinateCompaction, createCompactionSession } from './compaction/coordinator'
import { sanitizeModelMessages } from './modelMessageIntegrity'
import { prepareContextRequest, ContextUsageCorrection, type PreparedContextRequest } from './contextRequest'
import { resolveContextCapabilities, resolveStoredOutputMaximum } from './contextCapabilities'
import type { CompactionPacket } from './compaction/contracts'
import type { ConversationMemory } from './compaction/durableMemory'
import {
  createCompactionStreamFactory,
  resolveCompactionModelSelection,
} from './compaction/modelSelection'
import {
  buildChatPrompt,
  hasImageAttachmentsInModelMessages,
  stripImageAttachmentsFromModelMessages,
} from './messages'
import { isUnsupportedImageInputError, resolveModelImageInputSupport } from './modelImageSupport'
import { appendStoredMessages } from '../../history/store'
import { appendBrowserAnnotationsToModelMessages } from '../../history/browserAnnotations'
import { createAgentToolBundle } from './tools'
import type { CodeModeExecutor } from './codeMode/executor'
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
import {
  createEphemeralToolVisualMessages,
  externalizeVisualToolResultMessages,
  stripEphemeralToolVisualMessages,
  stripVisualToolResultFiles,
} from './toolVisualResultMessages'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'

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
  const generationMetrics = new StreamGenerationMetrics()
  const conversationId = input.startInput.conversationId?.trim() || null
  let workspaceRootPath: string | null = null
  let codeModeExecutor: CodeModeExecutor | null = null
  let terminalOwner: WebContents | null = null
  let runWasRecorded = false
  let terminalCleanup: Promise<void> | null = null
  const stopTurnTerminals = (completed: boolean) => {
    terminalCleanup ??= (async () => {
      // Abort executor work before sweeping this turn's terminal sessions.
      await codeModeExecutor?.dispose()
      if (!workspaceRootPath) {
        return
      }
      const cancellation = input.abortController.signal.aborted
        ? resolveStreamCancellation(input.abortController.signal)
        : {
            reason: completed ? 'run_completed' as const : 'provider_failure' as const,
            requestedAt: Date.now(),
            surface: 'system' as const,
          }
      const terminals = await getTerminalBroker().applyRunCancellation(runId, {
        ...cancellation,
        policy: 'terminate',
        conversationId,
        runId,
      })
      const unfinished = terminals.filter((terminal) => !['terminated', 'session_lost'].includes(terminal.state))
      if (unfinished.length > 0) {
        console.error('AI turn terminal cleanup failed:', unfinished)
        throw new Error('Some AI commands could not be stopped. Check the terminal cleanup diagnostics.')
      }
    })()
    return terminalCleanup
  }
  let historyWriteError: unknown = null
  let queuedHistoryWrites = Promise.resolve()
  const queueHistoryWrite = (action: () => Promise<unknown>) => {
    queuedHistoryWrites = queuedHistoryWrites.then(async () => {
      try {
        await action()
      } catch (error) {
        historyWriteError = error
        console.error('Canonical chat history persistence failed.', error)
      }
    })
  }

  try {
    workspaceRootPath = normalizeWorkspacePath(input.startInput.agentContextRootPath)
    terminalOwner = createTerminalSessionOwner(input.webContents)
    const enabledSkills = await listEnabledSkills(workspaceRootPath)
    const activePlanPath = getLatestCompletedPlanPresentation(input.startInput.messages)?.relativePath ?? null
    const pendingVisualModelOutputs: ToolResultOutput[] = []
    let offeredVisualModelOutputCount = 0
    const acknowledgeOfferedVisualModelOutputs = () => {
      if (offeredVisualModelOutputCount <= 0) return
      pendingVisualModelOutputs.splice(0, offeredVisualModelOutputCount)
      offeredVisualModelOutputCount = 0
    }
    const createPendingVisualOfferMessages = () => {
      if (pendingVisualModelOutputs.length === 0 || offeredVisualModelOutputCount > 0) {
        return []
      }

      const messages = createEphemeralToolVisualMessages(pendingVisualModelOutputs)
      if (messages.length > 0) {
        offeredVisualModelOutputCount = pendingVisualModelOutputs.length
      }
      return messages
    }
    const toolBundle = await createAgentToolBundle(
      {
        captureModelOutput: (output) => {
          pendingVisualModelOutputs.push(output)
        },
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
    let replayConversationMemory: ConversationMemory | null = null

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
      replayConversationMemory = await readLatestConversationMemory(conversationId)
    }
    modelMessages = stripVisualToolResultFiles(modelMessages)
    if (!promptOptions.includeImageAttachments) {
      modelMessages = stripImageAttachmentsFromModelMessages(modelMessages)
    }
    modelMessages = applyWorkspaceInstructionsContext(modelMessages, workspaceRootPath)
    const initialStoredSettings = await getStoredSettings().catch(() => null)
    modelMessages = await applyWorkspaceMemoryContext(
      modelMessages,
      workspaceRootPath,
      initialStoredSettings?.workspaceMemoryEnabled ?? true,
    )
    modelMessages = applyConversationMemoryContext(modelMessages, replayConversationMemory)
    modelMessages = await appendBrowserAnnotationsToModelMessages(modelMessages, conversationId, workspaceRootPath)

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
    let latestConversationMemory: ConversationMemory | null = replayConversationMemory
    let nextRecordedStepNumber = 0
    let restartingAfterToolBoundary = false
    const systemPromptTokens = approximateTokenCount(prompt.system)
    const compactionSession = createCompactionSession()
    const usageCorrection = new ContextUsageCorrection()
    let preparedRequest: PreparedContextRequest | null = null
    let latestContextWindowTokens = contextCompaction.contextWindowTokens
    let lastReportedInputTokens: number | undefined
    const maximumOutputTokens = await resolveStoredOutputMaximum(input.startInput.providerId, input.startInput.modelId)
    const initialCapabilities = resolveContextCapabilities({
      providerId: input.startInput.providerId,
      modelId: input.startInput.modelId,
      contextWindowTokens: contextCompaction.contextWindowTokens,
      maximumOutputTokens,
    })
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
      maxOutputTokens: initialCapabilities.maxOutputTokens,
      messages: modelMessages,
      model: input.startInput.modelId,
      reasoningEffort: input.startInput.reasoningEffort,
      signal: input.abortController.signal,
      stopWhen: continueToolLoopUntilModelStops,
      system: prompt.system,
      tools,
      onStepEnd: (step) => {
        if (preparedRequest) {
          usageCorrection.observe(preparedRequest.state.budget.totalTokens, step.usage.reporting?.input === 'reported' ? step.usage.inputTokens : undefined)
          if (step.usage.reporting?.input === 'reported') {
            lastReportedInputTokens = step.usage.inputTokens
          }
        }
        const providerResponseMessages = externalizeVisualToolResultMessages(
          step.responseMessages as ModelMessage[],
        ).messages
        const durableResponseMessages = stripEphemeralToolVisualMessages(providerResponseMessages)
        const recordedStep = {
          ...step,
          contextUsage: preparedRequest?.state.usage,
          responseMessages: durableResponseMessages,
          stepNumber: nextRecordedStepNumber,
        }
        nextRecordedStepNumber += 1
        replayMessages = [
          ...replayMessages,
          ...providerResponseMessages,
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
        const visualProjection = externalizeVisualToolResultMessages(stepInput.messages)
        const pendingVisualMessages = createPendingVisualOfferMessages()
        const currentStepMessages = [
          ...visualProjection.messages,
          ...pendingVisualMessages,
          ...consumedSteerModelMessages,
        ]
        const hasPreparedMessageChanges = (
          consumedSteerModelMessages.length > 0
          || pendingVisualMessages.length > 0
          || visualProjection.changed
        )
        const durableCurrentStepMessages = stripEphemeralToolVisualMessages(currentStepMessages)
        const durableResponseMessages = stripEphemeralToolVisualMessages(
          externalizeVisualToolResultMessages(stepInput.responseMessages as ModelMessage[]).messages,
        )
        const compactionMessages = sanitizeModelMessages(resolveAutomaticCompactionMessages({
          messages: durableCurrentStepMessages,
          responseMessages: durableResponseMessages,
        }))

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
          return hasPreparedMessageChanges
            ? { messages: currentStepMessages }
            : undefined
        }

        const liveStoredSettings = await getStoredSettings().catch(() => null)
        const liveContextCompaction = liveStoredSettings
          ? normalizeContextCompactionSettings(liveStoredSettings.contextCompaction)
          : contextCompaction

        const capabilities = resolveContextCapabilities({
          providerId: input.startInput.providerId,
          modelId: input.startInput.modelId,
          contextWindowTokens: liveContextCompaction.contextWindowTokens,
          maximumOutputTokens,
        })
        latestContextWindowTokens = capabilities.contextWindowTokens
        const requestMessages = sanitizeModelMessages(shouldStripImageAttachments
          ? stripImageAttachmentsFromModelMessages(currentStepMessages)
          : currentStepMessages)
        const makeRequest = (messages: ModelMessage[], correctionTokens = 0) => prepareContextRequest({
          messages,
          capabilities,
          systemPromptTokens,
          toolSchemaTokens: promptContext.toolSchemaTokens,
          triggerRatio: liveContextCompaction.triggerPercent / 100,
          correctionTokens,
        })
        preparedRequest = makeRequest(requestMessages, usageCorrection.prepare(requestMessages))
        preparedRequest.state.usage.lastReportedInputTokens = lastReportedInputTokens
        emitContextUsage(preparedRequest.state.usage)
        let expectedSource: ReturnType<typeof captureCompactionSource> | undefined
        const outcome = await coordinateCompaction({
          request: preparedRequest,
          session: compactionSession,
          previousPacket: latestCompactionPacket,
          retainedContextTokens: liveContextCompaction.retainedContextTokens,
          signal: input.abortController.signal,
          onStarted: (attemptId) => {
            if (!conversationId) return
            emitChatStreamEvent(input.webContents, {
              attemptId, conversationId, streamId: input.streamId, type: 'compaction_started',
            })
          },
          onFinished: (diagnostic) => {
            if (!conversationId || diagnostic.outcome === 'compacted') return
            emitChatStreamEvent(input.webContents, {
              attemptId: diagnostic.attemptId, conversationId, streamId: input.streamId,
              type: 'compaction_failed', reason: diagnostic.reason ?? 'worker_error',
            })
          },
          report: async (diagnostic) => {
            if (conversationId) {
              await recordCompactionAttempt(conversationId, runId, diagnostic)
            }
          },
          run: async (window, targetTokens, diagnostic) => {
            diagnostic.logicalStep = logicalStepNumber
            await queuedHistoryWrites
            if (historyWriteError) {
              throw new CompactionError('commit_failed')
            }
            if (conversationId) {
              expectedSource = captureCompactionSource(await readCanonicalHistory(conversationId))
            }
            const compactionModel = await resolveCompactionModelSelection({
              modelId: input.startInput.modelId,
              providerId: input.startInput.providerId,
              reasoningEffort: input.startInput.reasoningEffort,
            })
            const createStream = await createCompactionStreamFactory(
              compactionModel.providerId, `${cacheKey}:compaction`, capabilities.contextWindowTokens,
            )
            diagnostic.workerProviderId = compactionModel.providerId
            diagnostic.workerModelId = compactionModel.modelId
            return compactModelMessages({
              conversationId, createStream, selectedWindow: window,
              messages: preparedRequest!.durableMessages,
              model: compactionModel.modelId, providerId: compactionModel.providerId,
              reasoningEffort: compactionModel.reasoningEffort,
              sourceModel: input.startInput.modelId, sourceProviderId: input.startInput.providerId,
              systemPromptTokens, toolSchemaTokens: promptContext.toolSchemaTokens,
              previousPacket: latestCompactionPacket, previousMemory: latestConversationMemory,
              workspaceRootPath, contextWindowTokens: capabilities.contextWindowTokens,
              retainedContextTokens: targetTokens,
              triggerRatio: liveContextCompaction.triggerPercent / 100,
              signal: input.abortController.signal, turnState: 'active',
              onWorkerUsage: (operation, usage) => diagnostic.workerUsage.push({ operation, usage }),
            })
          },
          rebuild: async (compacted) => {
            compacted.projectedMessages = await applyWorkspaceMemoryContext(
              compacted.projectedMessages, workspaceRootPath, liveStoredSettings?.workspaceMemoryEnabled ?? true,
            )
            return makeRequest([...compacted.projectedMessages, ...preparedRequest!.visualMessages])
          },
          commit: async (compacted, diagnostic) => {
            if (!conversationId) return
            await recordCompactionCommitted({
              expectedSource, signal: input.abortController.signal, runId, diagnostic,
              anchorUserMessageId: replayAnchorUserMessageId,
              compactionId: compacted.packet.packetId, conversationId, contextFingerprint,
              durableMemory: compacted.durableMemory, modelId: input.startInput.modelId,
              packet: compacted.packet, projectedMessages: compacted.projectedMessages,
              providerId: input.startInput.providerId, projectionVersion: compacted.projectionVersion,
              reasoningRetention: compacted.reasoningRetention, parentPacketId: compacted.packet.parentPacketId,
              sourceDigest: compacted.sourceDigest, sourceMessageIds: compacted.packet.sourceMessageIds,
            })
          },
        })
        if (outcome.status === 'aborted') {
          throw new CompactionError('aborted')
        }
        if (outcome.status === 'compacted') {
          replayMessages = outcome.request.requestMessages
          latestCompactionPacket = outcome.result.packet
          latestConversationMemory = outcome.result.durableMemory
          usageCorrection.reset()
          preparedRequest = outcome.request
          if (conversationId) {
            emitChatStreamEvent(input.webContents, {
              attemptId: outcome.diagnostic.attemptId, compactionId: outcome.result.packet.packetId, conversationId,
              streamId: input.streamId, type: 'compaction_committed',
            })
          }
          emitContextUsage(preparedRequest.state.usage)
          return { messages: preparedRequest.requestMessages, maxOutputTokens: capabilities.maxOutputTokens }
        }
        return { messages: requestMessages, maxOutputTokens: capabilities.maxOutputTokens }

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
          acknowledgeOfferedVisualModelOutputs()
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
          generationMetrics,
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
          generationMetrics,
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
      getContinuationMessages: () => {
        const pendingVisualMessages = createPendingVisualOfferMessages()
        return pendingVisualMessages.length > 0
          ? [...replayMessages, ...pendingVisualMessages]
          : replayMessages
      },
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

    await stopTurnTerminals(true)

    // No further request is pending. Save completion without an extra maintenance worker call.
    const completedRequest = prepareContextRequest({
      messages: stripEphemeralToolVisualMessages(replayMessages),
      capabilities: resolveContextCapabilities({
        providerId: input.startInput.providerId, modelId: input.startInput.modelId,
        contextWindowTokens: latestContextWindowTokens,
        maximumOutputTokens,
      }),
      systemPromptTokens, toolSchemaTokens: promptContext.toolSchemaTokens,
      triggerRatio: contextCompaction.triggerPercent / 100,
      scope: 'reconstructed_preview',
    })
    completedRequest.state.usage.lastReportedInputTokens = lastReportedInputTokens
    emitContextUsage(completedRequest.state.usage)

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
        messages: stripEphemeralToolVisualMessages(replayMessages),
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
    let failure = error
    let cleanupFailed = false
    try {
      await stopTurnTerminals(false)
    } catch (cleanupError) {
      cleanupFailed = true
      console.error('Failed to stop AI commands at the end of the chat turn:', cleanupError)
      failure = cleanupError
    }
    await queuedHistoryWrites
    if (conversationId && runWasRecorded) {
      const cancellation = input.abortController.signal.aborted
        ? resolveStreamCancellation(input.abortController.signal)
        : undefined
      await safelyPersistHistory(() => recordRunTerminal(
        conversationId,
        runId,
        input.abortController.signal.aborted && !cleanupFailed ? 'run_aborted' : 'run_failed',
        failure instanceof Error ? failure.message : String(failure),
        cancellation,
      ))
    }
    if (input.abortController.signal.aborted && !cleanupFailed) {
      emitChatStreamEvent(input.webContents, {
        conversationId,
        streamId: input.streamId,
        type: 'aborted',
      })
    } else {
      emitChatStreamEvent(input.webContents, {
        errorMessage: failure instanceof Error && failure.message.trim().length > 0 ? failure.message : 'Chat request failed.',
        conversationId,
        streamId: input.streamId,
        type: 'error',
      })
    }
  } finally {
    releaseTerminalToolStateForTurn(runId)
  }
}
