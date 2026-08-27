import type { ModelMessage } from 'ai'
import { estimateModelMessageContextUsage } from '../../../../src/lib/contextUsage'
import { projectCodeModeToolResultPart, truncatePreservingEdges } from './codeModeProjection'

const RETAINED_TEXT_KEYS = new Set(['text', 'value', 'body', 'source', 'code', 'program', 'input', 'args', 'arguments', 'output'])

type MessageRecord = Record<string, unknown>

function isRecord(value: unknown): value is MessageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMessageContent(message: ModelMessage): unknown {
  return (message as { content?: unknown }).content
}

function getToolCallIds(message: ModelMessage) {
  if (message.role !== 'assistant' || !Array.isArray(getMessageContent(message))) return []
  return (getMessageContent(message) as unknown[])
    .filter((part): part is MessageRecord => isRecord(part) && part.type === 'tool-call')
    .map((part) => typeof part.toolCallId === 'string' ? part.toolCallId : null)
    .filter((id): id is string => id !== null)
}

function getToolResultIds(message: ModelMessage) {
  if (message.role !== 'tool' || !Array.isArray(getMessageContent(message))) return []
  return (getMessageContent(message) as unknown[])
    .filter((part): part is MessageRecord => isRecord(part) && part.type === 'tool-result')
    .map((part) => typeof part.toolCallId === 'string' ? part.toolCallId : null)
    .filter((id): id is string => id !== null)
}

function truncatePayload(value: unknown, maximumCharacters: number): unknown {
  if (typeof value === 'string') return truncatePreservingEdges(value, maximumCharacters)
  if (Array.isArray(value)) return value.map((item) => truncatePayload(item, maximumCharacters))
  if (!isRecord(value)) return value

  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
    key,
    RETAINED_TEXT_KEYS.has(key)
      ? truncatePayload(nestedValue, maximumCharacters)
      : nestedValue,
  ]))
}

function truncateAssistantPart(part: MessageRecord, maximumCharacters: number) {
  const projected = { ...part }
  if (part.type === 'text' && typeof part.text === 'string') {
    projected.text = truncatePreservingEdges(part.text, maximumCharacters)
  }
  for (const key of ['input', 'args', 'arguments']) {
    if (key in projected) projected[key] = truncatePayload(projected[key], maximumCharacters)
  }
  return projected
}

function truncateToolResultPart(part: MessageRecord, maximumCharacters: number) {
  const projected = projectCodeModeToolResultPart(part)
  if (projected !== part || part.toolName === 'code_mode') return projected
  if (!isRecord(projected.output)) return projected

  return {
    ...projected,
    output: truncatePayload(projected.output, maximumCharacters),
  }
}

function projectMessageContent(message: ModelMessage, maximumCharacters: number): ModelMessage['content'] {
  const content = getMessageContent(message)
  if (typeof content === 'string') return truncatePreservingEdges(content, maximumCharacters)
  if (!Array.isArray(content)) return content as ModelMessage['content']

  if (message.role === 'assistant') {
    return content.map((part) => isRecord(part) ? truncateAssistantPart(part, maximumCharacters) : part) as ModelMessage['content']
  }

  if (message.role === 'tool') {
    return content.map((part) => (
      isRecord(part) && part.type === 'tool-result'
        ? truncateToolResultPart(part, maximumCharacters)
        : part
    )) as ModelMessage['content']
  }

  return content as ModelMessage['content']
}

function projectMessageToTokenBudget(message: ModelMessage, maximumTokens: number) {
  if (message.role === 'user') return message
  if (maximumTokens <= 0) return null

  const originalTokens = estimateModelMessageContextUsage([message]).totalTokens
  if (originalTokens <= maximumTokens) return message

  const maximumCharacters = Math.max(64, maximumTokens * 4)
  let low = 0
  let high = maximumCharacters
  let best: ModelMessage | null = null

  for (let attempt = 0; attempt < 12 && low <= high; attempt += 1) {
    const candidateCharacters = Math.floor((low + high) / 2)
    const candidate = {
      ...message,
      content: projectMessageContent(message, candidateCharacters),
    } as ModelMessage
    const candidateTokens = estimateModelMessageContextUsage([candidate]).totalTokens
    if (candidateTokens <= maximumTokens) {
      best = candidate
      low = candidateCharacters + 1
    } else {
      high = candidateCharacters - 1
    }
  }

  return best
}

function projectUnitToTokenBudget(unit: readonly ModelMessage[], maximumTokens: number) {
  const unitTokens = estimateModelMessageContextUsage(unit).totalTokens
  if (unitTokens <= maximumTokens) return [...unit]
  if (maximumTokens <= 0) return null

  const projectedUnit: ModelMessage[] = []
  let remainingUnitTokens = maximumTokens
  for (const message of unit) {
    const messageTokens = estimateModelMessageContextUsage([message]).totalTokens
    const messageBudget = messageTokens > 0 && remainingUnitTokens > 0
      ? Math.max(1, Math.floor(remainingUnitTokens * messageTokens / Math.max(1, unitTokens)))
      : remainingUnitTokens
    const projected = projectMessageToTokenBudget(message, messageBudget)
    if (!projected) return null
    projectedUnit.push(projected)
    remainingUnitTokens = Math.max(
      0,
      remainingUnitTokens - estimateModelMessageContextUsage([projected]).totalTokens,
    )
  }

  const projectedTokens = estimateModelMessageContextUsage(projectedUnit).totalTokens
  const requiresToolPair = unit.some(hasToolCall) || unit.some(hasToolResult)
  if (
    projectedUnit.length === 0 ||
    projectedTokens > maximumTokens ||
    (requiresToolPair && !containsCompleteToolExchange(projectedUnit, unit))
  ) {
    return null
  }

  return projectedUnit
}

function hasToolCall(message: ModelMessage) {
  return getToolCallIds(message).length > 0
}

function hasToolResult(message: ModelMessage) {
  return getToolResultIds(message).length > 0
}

function containsCompleteToolExchange(messages: readonly ModelMessage[], originalUnit: readonly ModelMessage[]) {
  const originalCallIds = new Set(originalUnit.flatMap(getToolCallIds))
  const originalResultIds = new Set(originalUnit.flatMap(getToolResultIds))
  if (originalCallIds.size === 0) return true

  const projectedCallIds = new Set(messages.flatMap(getToolCallIds))
  const projectedResultIds = new Set(messages.flatMap(getToolResultIds))
  return [...originalCallIds].every((id) => projectedCallIds.has(id) && projectedResultIds.has(id)) &&
    [...originalResultIds].every((id) => projectedCallIds.has(id))
}

function collectTurnUnits(turn: readonly ModelMessage[]) {
  const units: ModelMessage[][] = []
  for (let index = 0; index < turn.length; index += 1) {
    const message = turn[index]
    if (message.role !== 'assistant') {
      units.push([message])
      continue
    }

    const toolCallIds = getToolCallIds(message)
    if (toolCallIds.length === 0) {
      units.push([message])
      continue
    }

    const unit: ModelMessage[] = [message]
    const pendingIds = new Set(toolCallIds)
    for (let resultIndex = index + 1; resultIndex < turn.length && pendingIds.size > 0; resultIndex += 1) {
      const resultMessage = turn[resultIndex]
      if (resultMessage.role !== 'tool') break
      unit.push(resultMessage)
      getToolResultIds(resultMessage).forEach((id) => pendingIds.delete(id))
      index = resultIndex
    }
    units.push(unit)
  }
  return units
}

function estimateMessages(messages: readonly ModelMessage[]) {
  return estimateModelMessageContextUsage(messages).totalTokens
}

function findSemanticTailUnitIndex(units: readonly ModelMessage[][]) {
  const finalAssistantIndex = units.findLastIndex((unit) => unit.some((message) => (
    message.role === 'assistant' && !hasToolCall(message)
  )))
  return finalAssistantIndex >= 0 ? finalAssistantIndex : units.length - 1
}

/**
 * Retains an older turn's complete user content, useful leading tool context,
 * and the final assistant result when a whole-turn boundary would leave too
 * much of the configured history budget unused. User messages are atomic so
 * multimodal requests cannot be cut at the boundary. Tool exchanges remain
 * call/result pairs even when their payloads are projected.
 */
export function selectPartialTurnPrefix(turn: readonly ModelMessage[], availableTokens: number) {
  const userMessages: ModelMessage[] = []
  let firstNonUserIndex = 0
  while (firstNonUserIndex < turn.length && turn[firstNonUserIndex]?.role === 'user') {
    userMessages.push(turn[firstNonUserIndex] as ModelMessage)
    firstNonUserIndex += 1
  }

  if (userMessages.length === 0) return []

  const selected: ModelMessage[] = [...userMessages]
  const selectedTokens = estimateMessages(selected)
  if (selectedTokens >= availableTokens) return selected

  const units = collectTurnUnits(turn.slice(firstNonUserIndex))
  if (units.length === 0) return selected

  const semanticTailIndex = findSemanticTailUnitIndex(units)
  const tailUnit = units[semanticTailIndex]
  if (!tailUnit) return selected

  const remainingTokens = Math.max(0, availableTokens - selectedTokens)
  const tailTokens = estimateMessages(tailUnit)
  const tailBudget = semanticTailIndex === 0 || tailTokens <= remainingTokens
    ? Math.min(tailTokens, remainingTokens)
    : Math.max(1, Math.floor(remainingTokens * 0.5))
  const projectedTail = projectUnitToTokenBudget(tailUnit, tailBudget)
  if (!projectedTail) return selected

  const projectedTailTokens = estimateMessages(projectedTail)
  const prefixBudget = Math.max(0, remainingTokens - projectedTailTokens)
  let remainingPrefixTokens = prefixBudget
  for (let index = 0; index < semanticTailIndex; index += 1) {
    const unit = units[index]
    const unitTokens = estimateMessages(unit)
    if (unitTokens <= remainingPrefixTokens) {
      selected.push(...unit)
      remainingPrefixTokens -= unitTokens
      continue
    }

    const projectedUnit = projectUnitToTokenBudget(unit, remainingPrefixTokens)
    if (!projectedUnit) break
    selected.push(...projectedUnit)
    remainingPrefixTokens = Math.max(0, remainingPrefixTokens - estimateMessages(projectedUnit))
    break
  }

  selected.push(...projectedTail)

  return selected
}
