import type { WorkspaceExplorerReadFileResult } from '../types/chat/workspace'
import { isDocxPreviewablePath } from './docx-preview'
import { isPdfPreviewablePath } from './pdf-preview'
import {
  isWorkspaceFileCacheEntryFresh,
  MAX_CACHED_WORKSPACE_FILES,
  shouldRetainConsumedWorkspaceFile,
} from './workspaceFileCachePolicy'

interface WorkspaceFileCacheEntry {
  createdAt: number
  promise: Promise<WorkspaceExplorerReadFileResult>
  workspaceRootPath: string
}

const workspaceFileCache = new Map<string, WorkspaceFileCacheEntry>()
let docxPreviewRenderModulePromise: Promise<typeof import('./docxPreviewRenderCache')> | null = null
let pdfPreviewRenderModulePromise: Promise<typeof import('./pdfPreviewRenderCache')> | null = null

interface WorkspaceFileCacheOptions {
  consume?: boolean
  priority?: boolean
}

function createCacheKey(workspaceRootPath: string, relativePath: string) {
  return `${workspaceRootPath}\u0000${relativePath}`
}

function removeCacheEntriesForWorkspace(workspaceRootPath: string) {
  for (const [key, entry] of workspaceFileCache) {
    if (entry.workspaceRootPath === workspaceRootPath) {
      workspaceFileCache.delete(key)
    }
  }
}

function isBackgroundPreviewablePath(relativePath: string) {
  return isDocxPreviewablePath(relativePath) || isPdfPreviewablePath(relativePath)
}

function loadDocxPreviewRenderModule() {
  docxPreviewRenderModulePromise ??= import('./docxPreviewRenderCache')
  return docxPreviewRenderModulePromise
}

function loadPdfPreviewRenderModule() {
  pdfPreviewRenderModulePromise ??= import('./pdfPreviewRenderCache')
  return pdfPreviewRenderModulePromise
}

function warmPreview(result: WorkspaceExplorerReadFileResult, priority: boolean) {
  if (result.status !== 'ready' || !result.previewDataUrl) {
    return
  }

  if (isDocxPreviewablePath(result.relativePath)) {
    void loadDocxPreviewRenderModule()
      .then((previewModule) => {
        if (priority) {
          void previewModule.requestDocxPreviewRender(result.previewDataUrl!)
        } else {
          previewModule.prefetchDocxPreviewRender(result.previewDataUrl!)
        }
      })
      .catch(() => undefined)
    return
  }

  if (isPdfPreviewablePath(result.relativePath)) {
    void loadPdfPreviewRenderModule()
      .then((previewModule) => {
        if (priority) {
          void previewModule.requestPdfPreviewRender(result.previewDataUrl!)
        } else {
          previewModule.prefetchPdfPreviewRender(result.previewDataUrl!)
        }
      })
      .catch(() => undefined)
  }
}

export function readWorkspaceFileWithCache(
  input: { relativePath: string; workspaceRootPath: string },
  options?: WorkspaceFileCacheOptions,
) {
  const key = createCacheKey(input.workspaceRootPath, input.relativePath)
  const cachedEntry = workspaceFileCache.get(key)
  const isPersistentPreview = isBackgroundPreviewablePath(input.relativePath)
  const isCachedEntryFresh = cachedEntry && isWorkspaceFileCacheEntryFresh(
    cachedEntry.createdAt,
    Date.now(),
    isPersistentPreview,
  )
  if (cachedEntry && isCachedEntryFresh) {
    workspaceFileCache.delete(key)
    if (shouldRetainConsumedWorkspaceFile(options?.consume)) {
      workspaceFileCache.set(key, cachedEntry)
    }
    if (options?.priority) {
      return cachedEntry.promise.then((result) => {
        warmPreview(result, true)
        return result
      })
    }
    return cachedEntry.promise
  }
  if (cachedEntry) {
    workspaceFileCache.delete(key)
  }

  const promise = window.tidecodeWorkspace.readFile(input).then((result) => {
    if (result.status === 'missing') {
      workspaceFileCache.delete(key)
      return result
    }

    warmPreview(result, options?.priority === true)
    return result
  }).catch((error: unknown) => {
    workspaceFileCache.delete(key)
    throw error
  })

  workspaceFileCache.set(key, {
    createdAt: Date.now(),
    promise,
    workspaceRootPath: input.workspaceRootPath,
  })
  if (options?.consume) {
    const removeConsumedEntry = () => {
      if (workspaceFileCache.get(key)?.promise === promise) {
        workspaceFileCache.delete(key)
      }
    }
    void promise.then(removeConsumedEntry, removeConsumedEntry)
  }
  while (workspaceFileCache.size > MAX_CACHED_WORKSPACE_FILES) {
    const oldestKey = workspaceFileCache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }
    workspaceFileCache.delete(oldestKey)
  }
  return promise
}

export function prefetchWorkspaceFile(
  input: { relativePath: string; workspaceRootPath: string },
  options?: WorkspaceFileCacheOptions,
) {
  void readWorkspaceFileWithCache(input, options).catch(() => undefined)
}

export function clearWorkspaceFilePreviewCache(workspaceRootPath?: string) {
  if (workspaceRootPath) {
    removeCacheEntriesForWorkspace(workspaceRootPath)
  } else {
    workspaceFileCache.clear()
  }
  if (docxPreviewRenderModulePromise) {
    void docxPreviewRenderModulePromise
      .then((previewModule) => previewModule.clearDocxPreviewRenderCache())
      .catch(() => undefined)
  }
  if (pdfPreviewRenderModulePromise) {
    void pdfPreviewRenderModulePromise
      .then((previewModule) => previewModule.clearPdfPreviewRenderCache())
      .catch(() => undefined)
  }
}
