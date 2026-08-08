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
  Message,
  StartChatStreamInput,
} from '../../../src/types/chat'
import { approximateTokenCount } from '../../../src/lib/contextUsage'
import { normalizeContextCompactionSettings } from '../../../src/lib/contextCompactionSettings'
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
  mergeAutomaticCompactionMessages,
  resolveAutomaticCompactionTrigger,
} from './compaction/automatic'
import { assertCompactionGate } from './compaction/gate'
import { calculateModelMessagesBudget, shouldCompactContext } from './compaction/budget'
import type { CompactionPacket } from './compaction/contracts'
import {
  buildChatPrompt,
  ensureCurrentExecutionModeContext,
} from './messages'
import { createAgentTools } from './tools'
import { terminateAllBackgroundSessionsForTurn } from './tools/terminalTools'
import { sortToolSet } from './runtimeToolSet'
import { continueToolLoopUntilModelStops } from './toolLoopPolicy'
import {
  emitChatStreamEvent,
  processRuntimeStream,
  type RuntimeStreamPart,
} from './runtimeStreamEvents'
import {
  withCanonicalToolModelOutputs,
} from './toolReplay'

export { estimateToolEnabledContextUsage } from './runtimeContextUsage'

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
  streamId: string
  webContents: WebContents
}) {
  const contextCompaction = normalizeContextCompactionSettings(input.startInput.contextCompaction)
  const runId = randomUUID()
  const conversationId = input.startInput.conversationId?.trim() || null
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
        turnId: runId,
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
    const tools = applyPromptCacheBreakpoints(
      withCanonicalToolModelOutputs(sortToolSet(rawTools)),
      input.startInput.providerId,
    )
    const promptOptions = {
      ...input.promptOptions,
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

    const anchorUserMessageId = [...input.startInput.messages].reverse()
      .find((message) => message.role === 'user')?.id ?? null
    const cacheKey = derivePromptCacheKey({
      cacheScopeId: input.startInput.cacheScopeId?.trim() || conversationId || 'ephemeral',
      contextFingerprint,
      modelId: input.startInput.modelId,
      providerId: input.startInput.providerId,
    })
    let replayMessages: ModelMessage[] = [...modelMessages]
    let latestCompactionPacket: CompactionPacket | null = replayCompactionPacket
    const systemPromptTokens = approximateTokenCount(prompt.system)

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
        const compactionMessages = mergeAutomaticCompactionMessages({
          messages: stepInput.messages,
          responseMessages: stepInput.responseMessages,
        })
        const automaticTrigger = resolveAutomaticCompactionTrigger({
          abortSignal: input.abortController.signal,
          messages: compactionMessages,
          responseMessages: stepInput.responseMessages,
          stepNumber: stepInput.stepNumber,
        })
        if (!automaticTrigger) return undefined

        const compactionBudgetInput = {
          contextWindowTokens: contextCompaction.contextWindowTokens,
          messages: compactionMessages,
          systemPromptTokens,
          toolSchemaTokens: promptContext.toolSchemaTokens,
          triggerRatio: contextCompaction.triggerPercent / 100,
        }
        const compactionRequired = shouldCompactContext(calculateModelMessagesBudget(compactionBudgetInput))

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
            contextWindowTokens: contextCompaction.contextWindowTokens,
            triggerRatio: contextCompaction.triggerPercent / 100,
            signal: input.abortController.signal,
          })
        } catch (error) {
          emitCompactionFailed('error')
          throw error
        }
        if (input.abortController.signal.aborted) {
          emitCompactionFailed('aborted')
          return undefined
        }
        if (!compacted) {
          emitCompactionFailed('unavailable')
          assertCompactionGate({
            aborted: false,
            compactionResult: null,
            projectedBudget: null,
            required: compactionRequired,
          })
          return undefined
        }

        const projectedBudget = calculateModelMessagesBudget({
          ...compactionBudgetInput,
          messages: compacted.projectedMessages,
        })
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
            anchorUserMessageId,
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
            usedFallback: compacted.usedFallback,
          }))
          emitChatStreamEvent(input.webContents, {
            compactionId: compacted.packet.packetId,
            conversationId,
            streamId: input.streamId,
            type: 'compaction_committed',
          })
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

    const processedStream = await processRuntimeStream({
      abortController: input.abortController,
      conversationId,
      fullStream: stream.fullStream,
      queueHistoryWrite,
      streamId: input.streamId,
      webContents: input.webContents,
    })

    // Some providers close their async iterable normally after receiving an
    // abort signal instead of throwing an AbortError. Treat that close as an
    // abort before the normal completion path can update canonical replay or
    // emit a completed event.
    if (processedStream.wasAborted || input.abortController.signal.aborted) {
      throw new Error('Chat stream aborted.')
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
    if (input.startInput.agentContextRootPath) {
      await terminateAllBackgroundSessionsForTurn(
        input.webContents,
        input.startInput.agentContextRootPath,
        runId,
      ).catch(() => undefined)
    }
  }
}
