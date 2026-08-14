export interface ContextCompactionSettings {
  contextWindowTokens: number
  retainedContextTokens: number
  triggerPercent: number
}

export const DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS = 10_000

export const CONTEXT_COMPACTION_RETAINED_TOKEN_OPTIONS = [
  4_000,
  8_000,
  DEFAULT_CONTEXT_COMPACTION_RETAINED_TOKENS,
  12_000,
  16_000,
  20_000,
] as const

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
    maximum: 20_000,
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
