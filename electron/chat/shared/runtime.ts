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
import { buildSkillsSystemPromptBlock, listEnabledSkills } from '../../skills/service'
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
import { findLatestCompactionPacket } from './compaction/window'
import {
  buildChatPrompt,
  ensureCurrentExecutionModeContext,
} from './messages'
import {
  createAgentTools,
  repairDirectDynamicToolCall,
} from './tools'
import { cleanUpFinishedSessionsAtTurnEnd } from './tools/terminalTools'
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
  onSettled?: () => void
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
      availableSkillsBlock: buildSkillsSystemPromptBlock(enabledSkills),
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
      stopWhen: continueToolLoopUntilModelStops,
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

    await processRuntimeStream({
      abortController: input.abortController,
      conversationId,
      fullStream: stream.fullStream,
      queueHistoryWrite,
      streamId: input.streamId,
      webContents: input.webContents,
    })

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
