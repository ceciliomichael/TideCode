import type { ReasoningEffort } from '../types/chat'

const REASONING_EFFORT_DISPLAY_ORDER: readonly ReasoningEffort[] = [
  'max',
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'none',
]

const REASONING_EFFORT_DISPLAY_RANKS: ReadonlyMap<ReasoningEffort, number> = new Map(
  REASONING_EFFORT_DISPLAY_ORDER.map((effort, index) => [effort, index]),
)

export function orderReasoningEfforts(options: readonly ReasoningEffort[]): ReasoningEffort[] {
  return options
    .map((option, originalIndex) => ({ option, originalIndex }))
    .sort((left, right) => {
      const leftRank = REASONING_EFFORT_DISPLAY_RANKS.get(left.option) ?? Number.MAX_SAFE_INTEGER
      const rightRank = REASONING_EFFORT_DISPLAY_RANKS.get(right.option) ?? Number.MAX_SAFE_INTEGER
      return leftRank - rightRank || left.originalIndex - right.originalIndex
    })
    .map(({ option }) => option)
}
