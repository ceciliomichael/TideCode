import { MODEL_CATALOG } from './modelCatalog'
import type { ModelCatalogItem, ModelToggleState } from './modelTypes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function buildDefaultModelToggleState(): ModelToggleState {
  return MODEL_CATALOG.reduce<ModelToggleState>((result, model) => {
    result[model.id] = model.enabledByDefault
    return result
  }, {})
}

export function sanitizeModelToggleState(input: unknown): ModelToggleState {
  const defaults = buildDefaultModelToggleState()

  if (!isRecord(input)) {
    return defaults
  }

  for (const [modelId, rawValue] of Object.entries(input)) {
    if (isBoolean(rawValue)) {
      defaults[modelId] = rawValue
    }
  }

  for (const model of MODEL_CATALOG) {
    const rawValue = input[model.id]
    if (isBoolean(rawValue)) {
      defaults[model.id] = rawValue
    }
  }

  return defaults
}

export function filterEnabledModelCatalogItems(
  models: readonly ModelCatalogItem[],
  toggleState: ModelToggleState = readStoredModelToggleState(),
): ModelCatalogItem[] {
  return models.filter((model) => toggleState[model.id] ?? model.enabledByDefault)
}

export function readStoredModelToggleState(): ModelToggleState {
  if (typeof window === 'undefined' || typeof window.echosphereSettings?.getInitialSettings !== 'function') {
    return buildDefaultModelToggleState()
  }

  try {
    const raw = window.echosphereSettings.getInitialSettings().modelToggleState
    if (!raw) {
      return buildDefaultModelToggleState()
    }

    return sanitizeModelToggleState(raw)
  } catch {
    return buildDefaultModelToggleState()
  }
}

export function writeStoredModelToggleState(state: ModelToggleState) {
  if (typeof window === 'undefined' || typeof window.echosphereSettings?.updateSettings !== 'function') {
    return
  }

  try {
    void window.echosphereSettings.updateSettings({ modelToggleState: state })
  } catch {
    // Ignore settings write failures.
  }
}
