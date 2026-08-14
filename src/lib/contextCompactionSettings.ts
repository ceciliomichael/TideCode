export interface ContextCompactionSettings {
  contextWindowTokens: number
  /** Internal compatibility value; retention is no longer user-configurable. */
  retainedContextTokens: number
  triggerPercent: number
}

export const DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS = 10_000
export const MAX_CONTEXT_COMPACTION_RETAINED_TOKENS = 20_000

export const DEFAULT_CONTEXT_COMPACTION_SETTINGS: ContextCompactionSettings = {
  contextWindowTokens: 200_000,
  retainedContextTokens: DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
  triggerPercent: 80,
}

export const CONTEXT_COMPACTION_LIMITS = {
  contextWindowTokens: {
    maximum: 2_000_000,
    minimum: 16_000,
  },
  retainedContextTokens: {
    maximum: MAX_CONTEXT_COMPACTION_RETAINED_TOKENS,
    minimum: 4_000,
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

export function capRetainedContextTokens(value: number | undefined, fallback = DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS) {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(MAX_CONTEXT_COMPACTION_RETAINED_TOKENS, Math.max(1, candidate))
}

export function normalizeContextCompactionSettings(
  input: (Partial<ContextCompactionSettings> & { retainedTurnCount?: unknown }) | null | undefined,
): ContextCompactionSettings {
  const contextWindowTokens = clampInteger(
    input?.contextWindowTokens,
    CONTEXT_COMPACTION_LIMITS.contextWindowTokens.minimum,
    CONTEXT_COMPACTION_LIMITS.contextWindowTokens.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens,
  )
  const retainedContextTokens = clampInteger(
    input?.retainedContextTokens,
    CONTEXT_COMPACTION_LIMITS.retainedContextTokens.minimum,
    CONTEXT_COMPACTION_LIMITS.retainedContextTokens.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.retainedContextTokens,
  )
  const triggerPercent = clampInteger(
    input?.triggerPercent,
    CONTEXT_COMPACTION_LIMITS.triggerPercent.minimum,
    CONTEXT_COMPACTION_LIMITS.triggerPercent.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent,
  )
  return {
    contextWindowTokens,
    retainedContextTokens,
    triggerPercent,
  }
}

export function mergeContextCompactionSettings(
  current: ContextCompactionSettings,
  patch: Partial<ContextCompactionSettings>,
) {
  return normalizeContextCompactionSettings({ ...current, ...patch })
}
