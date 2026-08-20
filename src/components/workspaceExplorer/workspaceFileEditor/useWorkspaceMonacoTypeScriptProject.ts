import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Monaco } from '@monaco-editor/react'
import type { WorkspaceTypeScriptProjectSnapshot } from '../../../types/chat'
import {
  getPreloadedWorkspaceMonacoRuntime,
  preloadWorkspaceMonacoRuntime,
} from '../../../lib/workspaceMonacoPreload'
import { normalizeWorkspaceRootPathForComparison } from '../../../lib/workspaceRootPathComparison'
import { createWorkspaceMonacoModelPath } from './workspaceMonacoConfig'
import {
  applyWorkspaceMonacoTypeScriptProject,
  getWorkspaceMonacoScriptLanguage,
  isWorkspaceMonacoTypeScriptFileHydrated,
  type WorkspaceMonacoScriptLanguage,
} from './workspaceMonacoTypeScriptProject'

interface UseWorkspaceMonacoTypeScriptProjectOptions {
  filePath: string
  language: string
  monacoRef: RefObject<Monaco | null>
  workspaceRootPath?: string | null
}

interface RefreshProjectOptions {
  force?: boolean
  replaceMissing?: boolean
}

type TypeScriptWorkerFactory = Awaited<ReturnType<Monaco['languages']['typescript']['getTypeScriptWorker']>>
type TypeScriptWorker = Awaited<ReturnType<TypeScriptWorkerFactory>>

const PROJECT_REFRESH_DEBOUNCE_MS = 140
const PROJECT_SNAPSHOT_CACHE_LIMIT = 4
const projectSnapshotCache = new Map<string, Promise<WorkspaceTypeScriptProjectSnapshot>>()

function createProjectBaseKey(workspaceRootPath: string, filePath: string) {
  return normalizeWorkspaceRootPathForComparison(workspaceRootPath) + '\0' + filePath.trim().replace(/\\/gu, '/')
}

function createProjectRequestKey(
  workspaceRootPath: string,
  filePath: string,
  includeDependencyDeclarations: boolean,
) {
  return createProjectBaseKey(workspaceRootPath, filePath)
    + '\0'
    + (includeDependencyDeclarations ? 'full' : 'source')
}

function cacheProjectSnapshot(key: string, promise: Promise<WorkspaceTypeScriptProjectSnapshot>) {
  projectSnapshotCache.delete(key)
  projectSnapshotCache.set(key, promise)
  while (projectSnapshotCache.size > PROJECT_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = projectSnapshotCache.keys().next().value as string | undefined
    if (!oldestKey) break
    projectSnapshotCache.delete(oldestKey)
  }
}

function invalidateWorkspaceProjectSnapshots(workspaceRootPath: string) {
  const prefix = normalizeWorkspaceRootPathForComparison(workspaceRootPath) + '\0'
  for (const key of Array.from(projectSnapshotCache.keys())) {
    if (key.startsWith(prefix)) {
      projectSnapshotCache.delete(key)
    }
  }
}

function requestWorkspaceTypeScriptProject(
  workspaceRootPath: string,
  filePath: string,
  includeDependencyDeclarations: boolean,
  force: boolean,
) {
  const requestKey = createProjectRequestKey(workspaceRootPath, filePath, includeDependencyDeclarations)
  if (!force) {
    const cached = projectSnapshotCache.get(requestKey)
    if (cached) {
      projectSnapshotCache.delete(requestKey)
      projectSnapshotCache.set(requestKey, cached)
      return cached
    }
  }

  const promise = window.tidecodeWorkspace.getTypeScriptProject({
    includeDependencyDeclarations,
    relativePath: filePath,
    workspaceRootPath,
  }).catch((error: unknown) => {
    if (projectSnapshotCache.get(requestKey) === promise) {
      projectSnapshotCache.delete(requestKey)
    }
    throw error
  })
  cacheProjectSnapshot(requestKey, promise)
  return promise
}

function warmWorkspaceTypeScriptWorker(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
  filePath: string,
) {
  const uri = monaco.Uri.parse(createWorkspaceMonacoModelPath(filePath))
  const getWorker = language === 'typescript'
    ? monaco.languages.typescript.getTypeScriptWorker
    : monaco.languages.typescript.getJavaScriptWorker

  void getWorker()
    .then((workerFactory: TypeScriptWorkerFactory) => workerFactory(uri))
    .then((worker: TypeScriptWorker) => worker.getSemanticDiagnostics(uri.toString()))
    .catch(() => undefined)
}

export function useWorkspaceMonacoTypeScriptProject({
  filePath,
  language,
  monacoRef,
  workspaceRootPath,
}: UseWorkspaceMonacoTypeScriptProjectOptions) {
  const activeProjectKeyRef = useRef<string | null>(null)

  const refreshProject = useCallback(async (
    monacoOverride?: Monaco,
    options: RefreshProjectOptions = {},
  ) => {
    const scriptLanguage = getWorkspaceMonacoScriptLanguage(language)
    const normalizedWorkspaceRootPath = workspaceRootPath?.trim() ?? ''
    const normalizedFilePath = filePath.trim()
    if (!scriptLanguage || !normalizedWorkspaceRootPath || !normalizedFilePath) {
      return
    }

    const projectKey = createProjectBaseKey(normalizedWorkspaceRootPath, normalizedFilePath)
    activeProjectKeyRef.current = projectKey
    const force = options.force === true
    const existingMonaco = monacoOverride ?? monacoRef.current ?? getPreloadedWorkspaceMonacoRuntime()
    if (
      !force &&
      existingMonaco &&
      isWorkspaceMonacoTypeScriptFileHydrated(
        existingMonaco,
        scriptLanguage,
        normalizedWorkspaceRootPath,
        normalizedFilePath,
      )
    ) {
      return
    }

    try {
      // Stage 1 contains workspace source files and project config only. It is much smaller than
      // the full snapshot, so local imports, aliases, and Go to Definition become available first.
      const sourceSnapshotPromise = requestWorkspaceTypeScriptProject(
        normalizedWorkspaceRootPath,
        normalizedFilePath,
        false,
        force,
      )
      const [sourceSnapshot, monacoInstance] = await Promise.all([
        sourceSnapshotPromise,
        monacoOverride ? Promise.resolve(monacoOverride) : preloadWorkspaceMonacoRuntime(),
      ])
      if (activeProjectKeyRef.current !== projectKey) return
      if (monacoRef.current && monacoOverride && monacoRef.current !== monacoOverride) return
      if (
        !force &&
        isWorkspaceMonacoTypeScriptFileHydrated(
          monacoInstance,
          scriptLanguage,
          normalizedWorkspaceRootPath,
          normalizedFilePath,
        )
      ) {
        return
      }

      applyWorkspaceMonacoTypeScriptProject(
        monacoInstance,
        scriptLanguage,
        normalizedWorkspaceRootPath,
        sourceSnapshot,
        {
          replaceMissing: false,
          semanticReady: false,
        },
      )
      warmWorkspaceTypeScriptWorker(monacoInstance, scriptLanguage, normalizedFilePath)

      // Stage 2 adds package declaration files. Semantic diagnostics stay suspended until this
      // completes so the fast source-only phase cannot flash false unresolved-package errors.
      const fullSnapshot = await requestWorkspaceTypeScriptProject(
        normalizedWorkspaceRootPath,
        normalizedFilePath,
        true,
        force,
      )
      if (activeProjectKeyRef.current !== projectKey) return
      if (monacoRef.current && monacoOverride && monacoRef.current !== monacoOverride) return
      if (
        !force &&
        isWorkspaceMonacoTypeScriptFileHydrated(
          monacoInstance,
          scriptLanguage,
          normalizedWorkspaceRootPath,
          normalizedFilePath,
        )
      ) {
        return
      }

      applyWorkspaceMonacoTypeScriptProject(
        monacoInstance,
        scriptLanguage,
        normalizedWorkspaceRootPath,
        fullSnapshot,
        {
          activeFilePath: normalizedFilePath,
          replaceMissing: options.replaceMissing,
          semanticReady: true,
        },
      )
      warmWorkspaceTypeScriptWorker(monacoInstance, scriptLanguage, normalizedFilePath)
    } catch (error) {
      if (activeProjectKeyRef.current !== projectKey) return
      console.warn('TideCode could not load TypeScript project metadata.', error)
    }
  }, [filePath, language, monacoRef, workspaceRootPath])

  useEffect(() => {
    const scriptLanguage = getWorkspaceMonacoScriptLanguage(language)
    const normalizedWorkspaceRootPath = workspaceRootPath?.trim() ?? ''
    if (!scriptLanguage || !normalizedWorkspaceRootPath || !filePath.trim()) {
      return
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    const workspaceKey = normalizeWorkspaceRootPathForComparison(normalizedWorkspaceRootPath)
    const unsubscribe = window.tidecodeWorkspace.onExplorerChange((event) => {
      if (normalizeWorkspaceRootPathForComparison(event.workspaceRootPath) !== workspaceKey) {
        return
      }
      invalidateWorkspaceProjectSnapshots(normalizedWorkspaceRootPath)
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer)
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void refreshProject(undefined, { force: true, replaceMissing: true })
      }, PROJECT_REFRESH_DEBOUNCE_MS)
    })

    // Start project hydration while the lazy Monaco view is still loading instead of waiting for
    // editor.onMount. Runtime loading and the source snapshot request happen in parallel.
    void refreshProject()

    return () => {
      activeProjectKeyRef.current = null
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer)
      }
      unsubscribe()
    }
  }, [filePath, language, refreshProject, workspaceRootPath])

  return refreshProject
}
