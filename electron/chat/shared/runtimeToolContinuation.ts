import type { ModelMessage } from 'ai'
import type { ProviderStepRecord } from '../history/contracts'

export interface ProviderContinuationResult {
  lastFinishReason: string | null
  lastStep: ProviderStepRecord | null
  wasAborted: boolean
}

function hasCodeModeToolResult(step: ProviderStepRecord | null) {
  if (!step) return false

  return step.responseMessages.some((message) => {
    if (!message || typeof message !== 'object') return false
    const candidate = message as { content?: unknown; role?: unknown }
    if (candidate.role !== 'tool' || !Array.isArray(candidate.content)) return false

    return candidate.content.some((part) => (
      typeof part === 'object'
      && part !== null
      && (part as { type?: unknown }).type === 'tool-result'
      && (part as { toolName?: unknown }).toolName === 'code_mode'
    ))
  })
}

export function shouldContinueAfterCodeModeToolResult(input: {
  result: ProviderContinuationResult
}) {
  return (
    !input.result.wasAborted
    && input.result.lastStep?.finishReason === 'tool-calls'
    && hasCodeModeToolResult(input.result.lastStep)
  )
}

export async function runProviderToolContinuationLoop<
  TInput extends { cacheKey: string; messages: ModelMessage[] },
  TResult extends ProviderContinuationResult,
>(input: {
  getContinuationMessages: () => ModelMessage[]
  initialInput: TInput
  run: (streamInput: TInput, continuationIndex: number) => Promise<TResult>
}) {
  let continuationIndex = 0
  let streamInput = input.initialInput

  while (true) {
    const result = await input.run(streamInput, continuationIndex)
    if (!shouldContinueAfterCodeModeToolResult({ result })) {
      return result
    }

    continuationIndex += 1
    streamInput = {
      ...input.initialInput,
      messages: [...input.getContinuationMessages()],
    }
  }
}
