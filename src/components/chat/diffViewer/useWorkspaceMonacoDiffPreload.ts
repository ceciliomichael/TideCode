import { useCallback, useEffect, useRef } from 'react'
import type { ConversationFileDiff } from '../../../lib/chatDiffs'
import { preloadWorkspaceMonacoDiffView, preloadWorkspaceMonacoRuntime } from '../../../lib/workspaceMonacoPreload'
import { resolveWorkspaceMonacoLanguage } from '../../workspaceExplorer/workspaceFileEditor/workspaceMonacoConfig'
import { ensureWorkspaceMonacoDiffModels } from './workspaceMonacoDiffModelCache'

interface UseWorkspaceMonacoDiffPreloadOptions {
  diffs: readonly ConversationFileDiff[]
  enabled: boolean
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

function scheduleIdleTask(callback: () => void) {
  const idleWindow = window as IdleWindow
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 250 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(callback, 16)
  return () => window.clearTimeout(handle)
}

function createDiffModelRequest(diff: ConversationFileDiff) {
  return {
    contentSignature: diff.contentSignature,
    filePath: diff.fileName,
    language: resolveWorkspaceMonacoLanguage(diff.fileName),
    newContent: diff.newContent,
    oldContent: diff.oldContent,
  }
}

export function useWorkspaceMonacoDiffPreload({ diffs, enabled }: UseWorkspaceMonacoDiffPreloadOptions) {
  const runtimePromiseRef = useRef<ReturnType<typeof preloadWorkspaceMonacoRuntime> | null>(null)
  const diffViewPromiseRef = useRef<ReturnType<typeof preloadWorkspaceMonacoDiffView> | null>(null)
  const preloadedDiffKeySetRef = useRef(new Set<string>())
  const inFlightDiffPreloadRef = useRef(new Map<string, Promise<void>>())

  const preloadDiff = useCallback(async (diff: ConversationFileDiff) => {
    const preloadKey = diff.contentSignature ?? `${diff.fileName}:${diff.oldContent ?? ''}:${diff.newContent}`
    if (preloadedDiffKeySetRef.current.has(preloadKey)) {
      return
    }

    const existingPreload = inFlightDiffPreloadRef.current.get(preloadKey)
    if (existingPreload) {
      await existingPreload
      return
    }

    const preloadPromise = (async () => {
      try {
        if (!runtimePromiseRef.current) {
          runtimePromiseRef.current = preloadWorkspaceMonacoRuntime()
        }
        if (!diffViewPromiseRef.current) {
          diffViewPromiseRef.current = preloadWorkspaceMonacoDiffView()
        }

        const [monaco] = await Promise.all([runtimePromiseRef.current, diffViewPromiseRef.current])
        ensureWorkspaceMonacoDiffModels(monaco, createDiffModelRequest(diff))
        preloadedDiffKeySetRef.current.add(preloadKey)
      } catch {
        // The DiffEditor can still create its models if background warming fails.
      }
    })()

    inFlightDiffPreloadRef.current.set(preloadKey, preloadPromise)
    try {
      await preloadPromise
    } finally {
      inFlightDiffPreloadRef.current.delete(preloadKey)
    }
  }, [])

  useEffect(() => {
    if (!enabled || diffs.length === 0) {
      return
    }

    let isCancelled = false
    let diffIndex = 0
    let cancelScheduledTask: (() => void) | null = null

    const preloadNextDiff = () => {
      if (isCancelled || diffIndex >= diffs.length) {
        return
      }

      const diff = diffs[diffIndex]
      diffIndex += 1
      void preloadDiff(diff)
        .catch(() => undefined)
        .finally(() => {
          if (!isCancelled) {
            cancelScheduledTask = scheduleIdleTask(preloadNextDiff)
          }
        })
    }

    preloadNextDiff()

    return () => {
      isCancelled = true
      cancelScheduledTask?.()
    }
  }, [diffs, enabled, preloadDiff])

  return preloadDiff
}
