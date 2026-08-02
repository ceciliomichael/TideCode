export interface ContextCompactionSettings {
  contextWindowTokens: number
  triggerPercent: number
  reserveTokens: number
}

export const DEFAULT_CONTEXT_COMPACTION_SETTINGS: ContextCompactionSettings = {
  contextWindowTokens: 200_000,
  triggerPercent: 78,
  reserveTokens: 24_000,
}

export const CONTEXT_COMPACTION_LIMITS = {
  contextWindowTokens: {
    maximum: 2_000_000,
    minimum: 16_000,
  },
  reserveTokens: {
    maximum: 100_000,
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
  input: Partial<ContextCompactionSettings> | null | undefined,
): ContextCompactionSettings {
  const contextWindowTokens = clampInteger(
    input?.contextWindowTokens,
    CONTEXT_COMPACTION_LIMITS.contextWindowTokens.minimum,
    CONTEXT_COMPACTION_LIMITS.contextWindowTokens.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.contextWindowTokens,
  )
  const triggerPercent = clampInteger(
    input?.triggerPercent,
    CONTEXT_COMPACTION_LIMITS.triggerPercent.minimum,
    CONTEXT_COMPACTION_LIMITS.triggerPercent.maximum,
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.triggerPercent,
  )
  const reserveTokens = clampInteger(
    input?.reserveTokens,
    CONTEXT_COMPACTION_LIMITS.reserveTokens.minimum,
    Math.min(CONTEXT_COMPACTION_LIMITS.reserveTokens.maximum, Math.floor(contextWindowTokens / 2)),
    DEFAULT_CONTEXT_COMPACTION_SETTINGS.reserveTokens,
  )

  return {
    contextWindowTokens,
    triggerPercent,
    reserveTokens,
  }
}

export function mergeContextCompactionSettings(
  current: ContextCompactionSettings,
  patch: Partial<ContextCompactionSettings>,
) {
  return normalizeContextCompactionSettings({ ...current, ...patch })
}
