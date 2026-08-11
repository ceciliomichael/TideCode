import type { Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

export interface WorkspaceMonacoDiffModelRequest {
  contentSignature?: string
  filePath: string
  language: string
  newContent: string
  oldContent: string | null | undefined
}

export interface WorkspaceMonacoDiffModelPaths {
  cacheKey: string
  modifiedModelPath: string
  originalModelPath: string
}

interface WorkspaceMonacoDiffModelCacheEntry {
  lastUsedAt: number
  modifiedModel: editor.ITextModel
  originalModel: editor.ITextModel
  paths: WorkspaceMonacoDiffModelPaths
  retainedCount: number
}

const MAX_CACHED_DIFF_MODEL_ENTRIES = 96
const cachedDiffModels = new Map<string, WorkspaceMonacoDiffModelCacheEntry>()
const pendingRetainCounts = new Map<string, number>()

function hashString(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function buildContentSignature(request: WorkspaceMonacoDiffModelRequest) {
  if (request.contentSignature && request.contentSignature.length > 0) {
    return request.contentSignature
  }

  const oldContent = request.oldContent ?? ''
  return [
    `${oldContent.length}:${hashString(oldContent)}`,
    `${request.newContent.length}:${hashString(request.newContent)}`,
  ].join('|')
}

function buildCacheKey(request: WorkspaceMonacoDiffModelRequest) {
  return `${request.filePath}\u0000${request.language}\u0000${buildContentSignature(request)}`
}

function createModelPath(cacheKey: string, side: 'modified' | 'original') {
  return `file:///tidecode/diff-cache/${hashString(cacheKey)}/${side}`
}

export function createWorkspaceMonacoDiffModelPaths(
  request: WorkspaceMonacoDiffModelRequest,
): WorkspaceMonacoDiffModelPaths {
  const cacheKey = buildCacheKey(request)
  return {
    cacheKey,
    modifiedModelPath: createModelPath(cacheKey, 'modified'),
    originalModelPath: createModelPath(cacheKey, 'original'),
  }
}

function getOrCreateModel(
  monaco: Monaco,
  modelPath: string,
  content: string,
  language: string,
) {
  const modelUri = monaco.Uri.parse(modelPath)
  const existingModel = monaco.editor.getModel(modelUri)
  if (existingModel && !existingModel.isDisposed()) {
    if (existingModel.getValue() !== content) {
      existingModel.setValue(content)
    }
    if (existingModel.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existingModel, language)
    }
    return existingModel
  }

  return monaco.editor.createModel(content, language, modelUri)
}

function touchEntry(entry: WorkspaceMonacoDiffModelCacheEntry) {
  entry.lastUsedAt = Date.now()
  cachedDiffModels.delete(entry.paths.cacheKey)
  cachedDiffModels.set(entry.paths.cacheKey, entry)
}

function disposeEntry(entry: WorkspaceMonacoDiffModelCacheEntry) {
  if (!entry.originalModel.isDisposed()) {
    entry.originalModel.dispose()
  }
  if (!entry.modifiedModel.isDisposed()) {
    entry.modifiedModel.dispose()
  }
}

function evictUnusedEntries() {
  while (cachedDiffModels.size > MAX_CACHED_DIFF_MODEL_ENTRIES) {
    const candidate = Array.from(cachedDiffModels.values())
      .filter((entry) => entry.retainedCount === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0]

    if (!candidate) {
      return
    }

    cachedDiffModels.delete(candidate.paths.cacheKey)
    disposeEntry(candidate)
  }
}

export function ensureWorkspaceMonacoDiffModels(
  monaco: Monaco,
  request: WorkspaceMonacoDiffModelRequest,
) {
  const paths = createWorkspaceMonacoDiffModelPaths(request)
  const existingEntry = cachedDiffModels.get(paths.cacheKey)
  if (existingEntry) {
    touchEntry(existingEntry)
    return paths
  }

  const originalModel = getOrCreateModel(
    monaco,
    paths.originalModelPath,
    request.oldContent ?? '',
    request.language,
  )
  const modifiedModel = getOrCreateModel(
    monaco,
    paths.modifiedModelPath,
    request.newContent,
    request.language,
  )
  const entry: WorkspaceMonacoDiffModelCacheEntry = {
    lastUsedAt: Date.now(),
    modifiedModel,
    originalModel,
    paths,
    retainedCount: pendingRetainCounts.get(paths.cacheKey) ?? 0,
  }

  cachedDiffModels.set(paths.cacheKey, entry)
  evictUnusedEntries()
  return paths
}

export function retainWorkspaceMonacoDiffModels(paths: WorkspaceMonacoDiffModelPaths) {
  const nextRetainCount = (pendingRetainCounts.get(paths.cacheKey) ?? 0) + 1
  pendingRetainCounts.set(paths.cacheKey, nextRetainCount)

  const entry = cachedDiffModels.get(paths.cacheKey)
  if (entry) {
    entry.retainedCount = nextRetainCount
    touchEntry(entry)
  }
}

export function releaseWorkspaceMonacoDiffModels(paths: WorkspaceMonacoDiffModelPaths) {
  const nextRetainCount = Math.max(0, (pendingRetainCounts.get(paths.cacheKey) ?? 0) - 1)
  if (nextRetainCount === 0) {
    pendingRetainCounts.delete(paths.cacheKey)
  } else {
    pendingRetainCounts.set(paths.cacheKey, nextRetainCount)
  }

  const entry = cachedDiffModels.get(paths.cacheKey)
  if (entry) {
    entry.retainedCount = nextRetainCount
    touchEntry(entry)
    evictUnusedEntries()
  }
}
