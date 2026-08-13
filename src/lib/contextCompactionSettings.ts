export interface ContextCompactionSettings {
  contextWindowTokens: number
  retainedTurnCount: number
  triggerPercent: number
}

export const DEFAULT_CONTEXT_COMPACTION_RETAINED_TURNS = 4

export const DEFAULT_CONTEXT_COMPACTION_SETTINGS: ContextCompactionSettings = {
  contextWindowTokens: 200_000,
  retainedTurnCount: DEFAULT_CONTEXT_COMPACTION_RETAINED_TURNS,
  triggerPercent: 80,
}

export const CONTEXT_COMPACTION_LIMITS = {
  contextWindowTokens: {
    maximum: 2_000_000,
    minimum: 16_000,
  },
  retainedTurnCount: {
    maximum: 12,
    minimum: 1,
  },
  triggerPercent: {
    maximum: 95,
    minimum: 50,
  },
} as const

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

export function normalizeContextCompactionSettings(
  input: Partial<ContextCompactionSettings> | null | undefined,
): ContextCompactionSettings {
  const contextWindowTokens = clampInteger(
    input?.contextWindowTokens,
    CONTEXT_COMPACTION_LIMITS.contextWindowTokens.minimum,
    CONTEXT_COMPACTION_LIMITS.contextWindowTokens.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens,
  )
  const retainedTurnCount = clampInteger(
    input?.retainedTurnCount,
    CONTEXT_COMPACTION_LIMITS.retainedTurnCount.minimum,
    CONTEXT_COMPACTION_LIMITS.retainedTurnCount.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.retainedTurnCount,
  )
  const triggerPercent = clampInteger(
    input?.triggerPercent,
    CONTEXT_COMPACTION_LIMITS.triggerPercent.minimum,
    CONTEXT_COMPACTION_LIMITS.triggerPercent.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent,
  )
  return {
    contextWindowTokens,
    retainedTurnCount,
    triggerPercent,
  }
}

export function mergeContextCompactionSettings(
  current: ContextCompactionSettings,
  patch: Partial<ContextCompactionSettings>,
) {
  return normalizeContextCompactionSettings({ ...current, ...patch })
}
