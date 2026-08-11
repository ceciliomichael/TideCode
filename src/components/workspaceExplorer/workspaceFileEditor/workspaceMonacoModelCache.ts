import type { editor } from 'monaco-editor'

interface RetainedWorkspaceMonacoModel {
  lastReleasedAt: number
  model: editor.ITextModel
  references: number
  releaseTimer: number | null
}

const MAX_RETAINED_WORKSPACE_MODELS = 12
const MODEL_RELEASE_DELAY_MS = 30_000
const retainedModels = new Map<string, RetainedWorkspaceMonacoModel>()

function disposeRetainedModel(modelKey: string, entry: RetainedWorkspaceMonacoModel) {
  if (entry.references > 0 || retainedModels.get(modelKey) !== entry) {
    return
  }

  if (entry.releaseTimer !== null) {
    window.clearTimeout(entry.releaseTimer)
  }
  retainedModels.delete(modelKey)
  if (!entry.model.isDisposed()) {
    entry.model.dispose()
  }
}

function pruneReleasedModels() {
  if (retainedModels.size <= MAX_RETAINED_WORKSPACE_MODELS) {
    return
  }

  const releasedModels = Array.from(retainedModels.entries())
    .filter(([, entry]) => entry.references === 0)
    .sort((left, right) => left[1].lastReleasedAt - right[1].lastReleasedAt)

  for (const [modelKey, entry] of releasedModels) {
    if (retainedModels.size <= MAX_RETAINED_WORKSPACE_MODELS) {
      break
    }
    disposeRetainedModel(modelKey, entry)
  }
}

export function retainWorkspaceMonacoModel(model: editor.ITextModel) {
  const modelKey = model.uri.toString()
  const existingEntry = retainedModels.get(modelKey)
  if (existingEntry) {
    if (existingEntry.releaseTimer !== null) {
      window.clearTimeout(existingEntry.releaseTimer)
      existingEntry.releaseTimer = null
    }
    existingEntry.references += 1
    existingEntry.model = model
    return
  }

  retainedModels.set(modelKey, {
    lastReleasedAt: 0,
    model,
    references: 1,
    releaseTimer: null,
  })
  pruneReleasedModels()
}

export function releaseWorkspaceMonacoModel(model: editor.ITextModel) {
  const modelKey = model.uri.toString()
  const entry = retainedModels.get(modelKey)
  if (!entry) {
    if (!model.isDisposed()) {
      model.dispose()
    }
    return
  }

  entry.references = Math.max(0, entry.references - 1)
  if (entry.references > 0) {
    return
  }

  entry.lastReleasedAt = Date.now()
  if (entry.releaseTimer !== null) {
    window.clearTimeout(entry.releaseTimer)
  }
  entry.releaseTimer = window.setTimeout(() => {
    disposeRetainedModel(modelKey, entry)
  }, MODEL_RELEASE_DELAY_MS)
  pruneReleasedModels()
}
