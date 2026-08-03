import type { WorkspaceExplorerReadFileResult } from '../types/chat/workspace'
import { isDocxPreviewablePath } from './docx-preview'
import { isPdfPreviewablePath } from './pdf-preview'
import { clearPdfPreviewRenderCache, prefetchPdfPreviewRender, requestPdfPreviewRender } from './pdfPreviewRenderCache'
import { clearDocxPreviewRenderCache, prefetchDocxPreviewRender, requestDocxPreviewRender } from './docxPreviewRenderCache'

interface WorkspaceFileCacheEntry {
  promise: Promise<WorkspaceExplorerReadFileResult>
  workspaceRootPath: string
}

const MAX_CACHED_PREVIEW_FILES = 3
const workspaceFileCache = new Map<string, WorkspaceFileCacheEntry>()

interface WorkspaceFileCacheOptions {
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

function warmPreview(result: WorkspaceExplorerReadFileResult, priority: boolean) {
  if (!result.previewDataUrl) {
    return
  }

  if (isDocxPreviewablePath(result.relativePath)) {
    if (priority) {
      requestDocxPreviewRender(result.previewDataUrl)
    } else {
      prefetchDocxPreviewRender(result.previewDataUrl)
    }
    return
  }

  if (isPdfPreviewablePath(result.relativePath)) {
    if (priority) {
      void requestPdfPreviewRender(result.previewDataUrl)
    } else {
      prefetchPdfPreviewRender(result.previewDataUrl)
    }
  }
}

export function readWorkspaceFileWithCache(
  input: { relativePath: string; workspaceRootPath: string },
  options?: WorkspaceFileCacheOptions,
) {
  if (!isBackgroundPreviewablePath(input.relativePath)) {
    return window.tidecodeWorkspace.readFile(input)
  }

  const key = createCacheKey(input.workspaceRootPath, input.relativePath)
  const cachedEntry = workspaceFileCache.get(key)
  if (cachedEntry) {
    if (options?.priority) {
      return cachedEntry.promise.then((result) => {
        warmPreview(result, true)
        return result
      })
    }
    return cachedEntry.promise
  }

  const promise = window.tidecodeWorkspace.readFile(input).then((result) => {
    warmPreview(result, options?.priority === true)
    return result
  }).catch((error: unknown) => {
    workspaceFileCache.delete(key)
    throw error
  })

  workspaceFileCache.set(key, { promise, workspaceRootPath: input.workspaceRootPath })
  while (workspaceFileCache.size > MAX_CACHED_PREVIEW_FILES) {
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
  clearDocxPreviewRenderCache()
  clearPdfPreviewRenderCache()
}
