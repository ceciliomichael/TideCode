import type { ModelMessage } from 'ai'
import { estimateModelMessageContextUsage } from '../../../../src/lib/contextUsage'
import { stableStringify } from '../../cache/canonicalization'
import {
  projectCodeModeToolCallPart,
  projectCodeModeToolResultPart,
} from './codeModeProjection'
import { selectPartialTurnPrefix } from './partialTurnRetention'
import { findConversationTurnRanges } from './turns'

export const RETAINED_TOOL_CALL_ARGUMENT_MAX_BYTES = 4 * 1024
const RETAINED_CONTEXT_MAX_OVERSHOOT_TOKENS = 4_000

export interface RetainedContextSelection {
  messages: ModelMessage[]
  /** True when the newest turn itself was reduced instead of retained whole. */
  partialNewestTurn?: true
  startIndex: number
  tokenCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncateToolArguments(value: unknown) {
  const serialized = stableStringify(value) ?? String(value)
  const serializedBytes = Buffer.byteLength(serialized, 'utf8')
  if (serializedBytes <= RETAINED_TOOL_CALL_ARGUMENT_MAX_BYTES) {
    return value
  }

  const placeholder = {
    __tidecode_truncated_tool_arguments: true,
    omittedBytes: serializedBytes,
  }
  return typeof value === 'string'
    ? `[Tool arguments truncated: ${serializedBytes} bytes omitted.]`
    : placeholder
}

function projectToolCallPart(part: Record<string, unknown>) {
  const projectedPart = { ...part }
  for (const key of ['args', 'arguments', 'input']) {
    if (key in projectedPart) {
      projectedPart[key] = truncateToolArguments(projectedPart[key])
    }
  }
  return projectedPart
}

export function projectRetainedMessageForContext(message: ModelMessage): ModelMessage {
  if (!Array.isArray(message.content)) {
    return message
  }

  if (message.role === 'tool') {
    return {
      ...message,
      content: (message.content as readonly unknown[]).map((part) => (
        isRecord(part) && part.type === 'tool-result'
          ? projectCodeModeToolResultPart(part)
          : part
      )),
    } as ModelMessage
  }

  if (message.role !== 'assistant') return message

  return {
    ...message,
    content: (message.content as readonly unknown[]).map((part) => (
      isRecord(part) && part.type === 'tool-call'
        ? part.toolName === 'code_mode'
          ? projectCodeModeToolCallPart(part)
          : projectToolCallPart(part)
        : part
    )),
  } as ModelMessage
}

export function projectRetainedMessagesForContext(messages: readonly ModelMessage[]) {
  return messages.map(projectRetainedMessageForContext)
}

export function estimateRetainedContextTokens(messages: readonly ModelMessage[]) {
  return estimateModelMessageContextUsage(messages).totalTokens
}

export function selectLatestContextByTokens(
  messages: readonly ModelMessage[],
  retainedContextTokens: number,
  options: { allowPartialNewestTurn?: boolean; force?: boolean } = {},
): RetainedContextSelection {
  const projectedMessages = projectRetainedMessagesForContext(messages)
  if (projectedMessages.length === 0) {
    return {
      messages: [],
      startIndex: 0,
      tokenCount: 0,
    }
  }

  const ranges = findConversationTurnRanges(projectedMessages)
  if (ranges.length === 0) {
    return {
      messages: projectedMessages,
      startIndex: 0,
      tokenCount: estimateRetainedContextTokens(projectedMessages),
    }
  }

  const targetTokens = Math.max(1, Math.floor(retainedContextTokens))
  const newestRange = ranges[ranges.length - 1]
  let retainedStartIndex = newestRange.startIndex
  let retainedMessages = projectedMessages.slice(retainedStartIndex)
  let tokenCount = estimateRetainedContextTokens(retainedMessages)

  // A single agent turn can become larger than the entire context window after
  // many tool calls. Whole-turn retention cannot make progress in that case
  // because the newest turn starts at the source boundary. Reuse the protected
  // partial-turn projector for the newest turn itself: the user request stays
  // atomic, tool call/result pairs stay complete, and the semantic tail is kept
  // while oversized intermediate evidence is bounded.
  if (options.allowPartialNewestTurn && tokenCount > targetTokens) {
    const newestTurn = projectedMessages.slice(newestRange.startIndex, newestRange.endIndex)
    const projectedNewestTurn = selectPartialTurnPrefix(newestTurn, targetTokens)
    if (projectedNewestTurn.length > 0) {
      const projectedNewestTurnTokens = estimateRetainedContextTokens(projectedNewestTurn)
      if (projectedNewestTurnTokens < tokenCount) {
        return {
          messages: projectedNewestTurn,
          partialNewestTurn: true,
          startIndex: newestRange.startIndex,
          tokenCount: projectedNewestTurnTokens,
        }
      }
    }
  }

  // A strict upper bound can leave a large amount of verified context out. For
  // example, a 4.6k latest turn plus a 7k previous turn should prefer the
  // complete 11.6k tail over keeping only 4.6k. Allow one bounded overshoot so
  // a complete turn is preserved when it is closer to the configured target.
  const maximumComparableTokenCount = targetTokens + RETAINED_CONTEXT_MAX_OVERSHOOT_TOKENS
  let closestDistance = Math.abs(tokenCount - targetTokens)

  for (let rangeIndex = ranges.length - 2; rangeIndex >= 0; rangeIndex -= 1) {
    const candidateStartIndex = ranges[rangeIndex].startIndex
    const candidateMessages = projectedMessages.slice(candidateStartIndex)
    const candidateTokenCount = estimateRetainedContextTokens(candidateMessages)

    // If the complete candidate crosses the target while the newer suffix is
    // still below it, first try the protected user-message prefix. This fills
    // the target without forcing the entire older turn into the projection.
    if (candidateTokenCount > targetTokens && tokenCount < targetTokens && rangeIndex > 0) {
      const newerSuffixStartIndex = ranges[rangeIndex + 1]?.startIndex
      if (newerSuffixStartIndex === undefined) break
      const newerSuffix = projectedMessages.slice(newerSuffixStartIndex)
      const newerSuffixTokens = estimateRetainedContextTokens(newerSuffix)
      const partialTurn = selectPartialTurnPrefix(
        projectedMessages.slice(ranges[rangeIndex].startIndex, ranges[rangeIndex].endIndex),
        Math.max(1, targetTokens - newerSuffixTokens),
      )
      const partialMessages = [...partialTurn, ...newerSuffix]
      const partialTokenCount = estimateRetainedContextTokens(partialMessages)
      const partialDistance = Math.abs(partialTokenCount - targetTokens)
      if (partialTurn.length > 0 && partialDistance < closestDistance) {
        retainedStartIndex = ranges[rangeIndex].startIndex
        retainedMessages = partialMessages
        tokenCount = partialTokenCount
        closestDistance = partialDistance
        break
      }
    }

    if (candidateTokenCount > maximumComparableTokenCount) {
      // A partial prefix beginning at the first source turn would leave no
      // evicted messages for compaction. It is valid as a retained projection,
      // but it cannot produce a safe compaction boundary.
      if (rangeIndex === 0) break

      const newerSuffixStartIndex = ranges[rangeIndex + 1]?.startIndex
      if (newerSuffixStartIndex === undefined) break
      const newerSuffix = projectedMessages.slice(newerSuffixStartIndex)
      const newerSuffixTokens = estimateRetainedContextTokens(newerSuffix)
      const availableTokens = Math.max(1, targetTokens - newerSuffixTokens)
      const partialTurn = selectPartialTurnPrefix(
        projectedMessages.slice(ranges[rangeIndex].startIndex, ranges[rangeIndex].endIndex),
        availableTokens,
      )
      if (partialTurn.length === 0) break

      const partialMessages = [...partialTurn, ...newerSuffix]
      const partialTokenCount = estimateRetainedContextTokens(partialMessages)
      const partialDistance = Math.abs(partialTokenCount - targetTokens)
      if (partialDistance < closestDistance || newerSuffixTokens < targetTokens) {
        retainedStartIndex = ranges[rangeIndex].startIndex
        retainedMessages = partialMessages
        tokenCount = partialTokenCount
        closestDistance = partialDistance
      }
      break
    }

    const candidateDistance = Math.abs(candidateTokenCount - targetTokens)
    if (candidateDistance <= closestDistance) {
      retainedStartIndex = candidateStartIndex
      retainedMessages = candidateMessages
      tokenCount = candidateTokenCount
      closestDistance = candidateDistance
    }
  }

  // Manual compaction remains useful even when the recent transcript is below
  // the configured retention target: retain the newest complete turn and
  // summarize everything before it.
  if (options.force && retainedStartIndex === 0 && ranges.length > 1) {
    retainedStartIndex = newestRange.startIndex
    retainedMessages = projectedMessages.slice(retainedStartIndex)
    tokenCount = estimateRetainedContextTokens(retainedMessages)
  }

  return {
    messages: retainedMessages,
    startIndex: retainedStartIndex,
    tokenCount,
  }
}
