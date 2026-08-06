import type { ModelMessage } from 'ai'
import type { ChatProviderId } from '../../../../src/types/chat'
import { sha256, stableStringify } from '../../cache/canonicalization'
import { stripExecutionModeContext } from '../../../../src/lib/executionModeContext'
import { buildContinuationMarkdownFromPacket } from './markdown'
import type { LocalCompactionPacketV2, ReasoningRetentionMode } from './contracts'

export type ProviderReasoningCapabilityMode = 'exact' | 'provider_native' | 'visible' | 'none'

export interface ProviderReasoningCapability {
  mode: ProviderReasoningCapabilityMode
  note: string
  providerId: ChatProviderId | 'unknown'
  modelId: string
}

type ReasoningContinuityEntry = LocalCompactionPacketV2['reasoningContinuity'][number]

const NATIVE_REASONING_REPLAY_PROVIDERS: readonly ChatProviderId[] = ['deepseek', 'openai']
const MAX_REASONING_ENTRY_TEXT = 1_200

function compactText(value: string, maxLength = MAX_REASONING_ENTRY_TEXT) {
  const normalized = stripExecutionModeContext(value).replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getParts(message: ModelMessage): readonly unknown[] {
  return Array.isArray(message.content) ? message.content : []
}

function getTextParts(message: ModelMessage, includeReasoning = false) {
  if (typeof message.content === 'string') return message.content
  return getParts(message)
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .filter((part) => part.type === 'text' || (includeReasoning && part.type === 'reasoning'))
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
}

function getToolCalls(message: ModelMessage) {
  return getParts(message)
    .filter((part): part is Record<string, unknown> => isRecord(part))
    .filter((part) => part.type === 'tool-call' && typeof part.toolCallId === 'string')
    .map((part) => ({
      id: part.toolCallId as string,
      input: part.input ?? part.args ?? null,
      name: typeof part.toolName === 'string' ? part.toolName : 'tool',
    }))
}

function getToolResult(message: ModelMessage, toolCallId: string) {
  if (message.role !== 'tool') return null
  const part = getParts(message)
    .find((candidate): candidate is Record<string, unknown> => (
      isRecord(candidate) && candidate.type === 'tool-result' && candidate.toolCallId === toolCallId
    ))
  if (!part) return null

  const output = isRecord(part.output) && typeof part.output.value === 'string'
    ? part.output.value
    : typeof part.output === 'string'
      ? part.output
      : getTextParts(message)
  return compactText(output || 'The tool returned no visible text.')
}

function hasReasoningPart(messages: readonly ModelMessage[]) {
  return messages.some((message) => getParts(message).some((part) => isRecord(part) && part.type === 'reasoning'))
}

function hasProviderMetadata(messages: readonly ModelMessage[]) {
  return messages.some((message) => getParts(message).some((part) => (
    isRecord(part) && isRecord(part.providerOptions)
  )))
}

function hasVisibleAssistantText(messages: readonly ModelMessage[]) {
  return messages.some((message) => message.role === 'assistant' && getTextParts(message).trim().length > 0)
}

function hasToolReasoning(messages: readonly ModelMessage[]) {
  return messages.some((message) => message.role === 'assistant' &&
    getToolCalls(message).length > 0 &&
    getParts(message).some((part) => isRecord(part) && part.type === 'reasoning'))
}

export function resolveProviderReasoningCapability(input: {
  modelId: string
  providerId?: ChatProviderId
  exactReplayAvailable?: boolean
}) : ProviderReasoningCapability {
  const providerId = input.providerId ?? 'unknown'
  if (input.exactReplayAvailable) {
    return {
      mode: 'exact',
      modelId: input.modelId,
      note: 'The canonical replay retained provider metadata for the original reasoning items.',
      providerId,
    }
  }

  if (input.providerId && NATIVE_REASONING_REPLAY_PROVIDERS.includes(input.providerId)) {
    return {
      mode: 'provider_native',
      modelId: input.modelId,
      note: `${input.providerId} uses a provider-native reasoning replay representation for tool turns.`,
      providerId,
    }
  }

  return {
    mode: 'visible',
    modelId: input.modelId,
    note: 'Only visible assistant rationale is eligible for Markdown continuity.',
    providerId,
  }
}

export function resolveReasoningRetention(input: {
  messages: readonly ModelMessage[]
  capability: ProviderReasoningCapability
}): LocalCompactionPacketV2['reasoningRetention'] {
  let mode: ReasoningRetentionMode = 'unavailable'
  let note = 'The compacted range contained no safe reasoning representation.'

  if (hasReasoningPart(input.messages) && input.capability.mode === 'exact' && hasProviderMetadata(input.messages)) {
    mode = 'replayed_exact'
    note = 'Provider reasoning items remain available through exact canonical replay metadata.'
  } else if (hasToolReasoning(input.messages) && input.capability.mode === 'provider_native') {
    mode = 'replayed_provider_native'
    note = input.capability.note
  } else if (hasVisibleAssistantText(input.messages) || hasReasoningPart(input.messages)) {
    mode = 'summarized_visible'
    note = 'Visible action-linked rationale was summarized; unavailable private reasoning was not reconstructed.'
  }

  return {
    mode,
    modelId: input.capability.modelId.trim() || 'unknown-model',
    note,
    providerId: input.capability.providerId,
  }
}

function makeEntryId(input: Pick<ReasoningContinuityEntry, 'situation' | 'action'>) {
  return `reasoning:${sha256(stableStringify({ action: input.action, situation: input.situation })).slice(0, 32)}`
}

function resolveOutcome(result: string | null): ReasoningContinuityEntry['outcome'] {
  if (!result) return 'pending'
  return /\b(?:error|failed|failure|denied|not found|invalid)\b/iu.test(result) ? 'rejected' : 'confirmed'
}

function resolveConfidence(result: string | null, rationale: string): ReasoningContinuityEntry['confidence'] {
  if (!result && rationale.length === 0) return 'unknown'
  if (result && !/\b(?:error|failed|failure|denied|not found|invalid)\b/iu.test(result)) return 'high'
  return rationale.length > 0 ? 'medium' : 'low'
}

function formatToolInput(input: unknown) {
  if (input === null || input === undefined) return ''
  const serialized = stableStringify(input)
  return serialized && serialized !== '{}' ? compactText(serialized, 700) : ''
}

function buildToolContinuityEntry(input: {
  assistantIndex: number
  call: { id: string; input: unknown; name: string }
  latestUser: string
  result: string | null
  resultIndex: number | null
  visibleRationale: string
}): ReasoningContinuityEntry {
  const actionInput = formatToolInput(input.call.input)
  const action = actionInput
    ? `Run ${input.call.name} with ${actionInput}.`
    : `Run ${input.call.name}.`
  const rationale = input.visibleRationale || 'The transcript does not state a visible rationale for this action.'
  const evidence = [
    `model:${input.assistantIndex}`,
    ...(input.resultIndex === null ? [] : [`model:${input.resultIndex}`]),
    ...(input.result ? [`Tool result: ${input.result}`] : []),
  ]
  const outcome = resolveOutcome(input.result)
  return {
    action: compactText(action),
    confidence: resolveConfidence(input.result, input.visibleRationale),
    evidence: evidence.map((value) => compactText(value)),
    id: makeEntryId({ action, situation: input.latestUser }),
    nextCheck: outcome === 'rejected' ? 'Address the reported failure before repeating the action.' : null,
    outcome,
    rationale: compactText(rationale),
    situation: compactText(input.latestUser || 'The active task required another verified action.'),
    sourceMessageIds: [
      `model:${input.assistantIndex}`,
      ...(input.resultIndex === null ? [] : [`model:${input.resultIndex}`]),
    ],
  }
}

export function extractActionLinkedReasoning(messages: readonly ModelMessage[], sourceStartIndex = 0): ReasoningContinuityEntry[] {
  const entries: ReasoningContinuityEntry[] = []
  let latestUser = ''

  messages.forEach((message, index) => {
    const sourceIndex = sourceStartIndex + index
    if (message.role === 'user') {
      latestUser = compactText(getTextParts(message))
      return
    }
    if (message.role !== 'assistant') return

    const calls = getToolCalls(message)
    const visibleRationale = compactText(getTextParts(message))
    if (calls.length > 0) {
      calls.forEach((call) => {
        let result: string | null = null
        let resultIndex: number | null = null
        for (let resultCandidateIndex = index + 1; resultCandidateIndex < messages.length; resultCandidateIndex += 1) {
          const candidate = getToolResult(messages[resultCandidateIndex], call.id)
          if (candidate === null) continue
          result = candidate
          resultIndex = sourceStartIndex + resultCandidateIndex
          break
        }
        entries.push(buildToolContinuityEntry({
          assistantIndex: sourceIndex,
          call,
          latestUser,
          result,
          resultIndex,
          visibleRationale,
        }))
      })
      return
    }

    if (visibleRationale.length === 0 || !/\b(?:because|therefore|so that|to verify|i will|i chose|next|need to|should)\b/iu.test(visibleRationale)) {
      return
    }

    const action = 'Continue the active task from the visible assistant rationale.'
    entries.push({
      action,
      confidence: 'medium',
      evidence: [`model:${sourceIndex}`],
      id: makeEntryId({ action, situation: latestUser }),
      nextCheck: null,
      outcome: 'pending',
      rationale: visibleRationale,
      situation: compactText(latestUser || 'The active task was still in progress.'),
      sourceMessageIds: [`model:${sourceIndex}`],
    })
  })

  return entries.slice(-32)
}

function continuityKey(entry: Pick<ReasoningContinuityEntry, 'situation' | 'action'>) {
  return `${entry.situation.toLowerCase()}\u0000${entry.action.toLowerCase()}`
}

export function mergeReasoningContinuity(
  previous: readonly ReasoningContinuityEntry[],
  current: readonly ReasoningContinuityEntry[],
) {
  const merged = new Map<string, ReasoningContinuityEntry>()
  previous.forEach((entry) => merged.set(continuityKey(entry), entry))
  current.forEach((entry) => {
    const key = continuityKey(entry)
    const prior = merged.get(key)
    if (!prior) {
      merged.set(key, entry)
      return
    }

    const outcome = entry.outcome === 'pending' ? prior.outcome : entry.outcome
    merged.set(key, {
      ...entry,
      evidence: Array.from(new Set([...prior.evidence, ...entry.evidence])).slice(-16),
      id: prior.id || entry.id,
      outcome,
      sourceMessageIds: Array.from(new Set([...prior.sourceMessageIds, ...entry.sourceMessageIds])).slice(-32),
    })
  })

  return [...merged.values()].slice(-32)
}

function mergeTextList(previous: readonly string[], current: readonly string[], limit = 64) {
  return Array.from(new Set([...current, ...previous].map((value) => value.trim()).filter(Boolean))).slice(0, limit)
}

function mergeFiles(
  previous: readonly LocalCompactionPacketV2['filesAndSymbols'][number][],
  current: readonly LocalCompactionPacketV2['filesAndSymbols'][number][],
) {
  const files = new Map<string, LocalCompactionPacketV2['filesAndSymbols'][number]>()
  for (const file of [...previous, ...current]) {
    const prior = files.get(file.path)
    if (!prior) {
      files.set(file.path, file)
      continue
    }
    files.set(file.path, {
      ...file,
      symbols: Array.from(new Set([...prior.symbols, ...file.symbols])).slice(0, 32),
    })
  }
  return [...files.values()].slice(0, 96)
}

function mergeObservations(
  previous: readonly LocalCompactionPacketV2['toolObservations'][number][],
  current: readonly LocalCompactionPacketV2['toolObservations'][number][],
) {
  const observations = new Map<string, LocalCompactionPacketV2['toolObservations'][number]>()
  for (const observation of previous) observations.set(observation.subject, observation)
  for (const observation of current) {
    const prior = observations.get(observation.subject)
    if (prior && prior.fact !== observation.fact && prior.status === 'current') {
      observations.set(`${observation.subject}:stale:${observations.size}`, { ...prior, status: 'stale' })
    }
    observations.set(observation.subject, observation)
  }
  return [...observations.values()].slice(-96)
}

export function mergeCompactionPacketState(input: {
  current: LocalCompactionPacketV2
  parentPacketId: string | null
  previous?: LocalCompactionPacketV2 | null
}) : LocalCompactionPacketV2 {
  const previous = input.previous
  const merged: LocalCompactionPacketV2 = {
    ...input.current,
    completedWork: mergeTextList(previous?.completedWork ?? [], input.current.completedWork),
    constraints: mergeTextList(previous?.constraints ?? [], input.current.constraints),
    currentState: mergeTextList(previous?.currentState ?? [], input.current.currentState),
    decisions: mergeTextList(previous?.decisions ?? [], input.current.decisions),
    failuresAndWorkarounds: mergeTextList(previous?.failuresAndWorkarounds ?? [], input.current.failuresAndWorkarounds),
    filesAndSymbols: mergeFiles(previous?.filesAndSymbols ?? [], input.current.filesAndSymbols),
    goal: mergeTextList(previous?.goal ?? [], input.current.goal),
    nextActions: mergeTextList(previous?.nextActions ?? [], input.current.nextActions),
    omitted: mergeTextList(previous?.omitted ?? [], input.current.omitted),
    openItems: mergeTextList(previous?.openItems ?? [], input.current.openItems),
    parentPacketId: input.parentPacketId,
    planState: mergeTextList(previous?.planState ?? [], input.current.planState),
    reasoningContinuity: mergeReasoningContinuity(previous?.reasoningContinuity ?? [], input.current.reasoningContinuity),
    toolObservations: mergeObservations(previous?.toolObservations ?? [], input.current.toolObservations),
    validation: mergeTextList(previous?.validation ?? [], input.current.validation),
  }

  return {
    ...merged,
    continuationMarkdown: input.current.continuationMarkdown || previous?.continuationMarkdown || buildContinuationMarkdownFromPacket(merged),
  }
}
