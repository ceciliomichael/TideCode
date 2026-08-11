import { loader, type Monaco } from '@monaco-editor/react'

type WorkspaceMonacoEditorViewModule = typeof import(
  '../components/workspaceExplorer/workspaceFileEditor/WorkspaceMonacoEditorView'
)
type WorkspaceMonacoDiffViewModule = typeof import(
  '../components/chat/diffViewer/WorkspaceMonacoDiffView'
)

let runtimePromise: Promise<Monaco> | null = null
let editorViewPromise: Promise<WorkspaceMonacoEditorViewModule> | null = null
let diffViewPromise: Promise<WorkspaceMonacoDiffViewModule> | null = null
let backgroundPreloadScheduled = false

export function preloadWorkspaceMonacoRuntime() {
  if (runtimePromise) {
    return runtimePromise
  }

  runtimePromise = Promise.all([
    import('../components/workspaceExplorer/workspaceFileEditor/workspaceMonacoEnvironment')
      .then(() => loader.init()),
    import('../components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTheme'),
    import('../components/workspaceExplorer/workspaceFileEditor/workspaceMonacoShiki'),
  ])
    .then(async ([monaco, { defineWorkspaceMonacoThemes }, { configureWorkspaceMonacoShiki }]) => {
      defineWorkspaceMonacoThemes(monaco)
      await configureWorkspaceMonacoShiki(monaco)
      return monaco
    })
    .catch((error: unknown) => {
      runtimePromise = null
      throw error
    })

  return runtimePromise
}

export function preloadWorkspaceMonacoEditorView() {
  if (editorViewPromise) {
    return editorViewPromise
  }

  editorViewPromise = Promise.all([
    preloadWorkspaceMonacoRuntime(),
    import('../components/workspaceExplorer/workspaceFileEditor/WorkspaceMonacoEditorView'),
  ])
    .then(([, editorViewModule]) => editorViewModule)
    .catch((error: unknown) => {
      editorViewPromise = null
      throw error
    })

  return editorViewPromise
}

export function preloadWorkspaceMonacoDiffView() {
  if (diffViewPromise) {
    return diffViewPromise
  }

  diffViewPromise = Promise.all([
    preloadWorkspaceMonacoRuntime(),
    import('../components/chat/diffViewer/WorkspaceMonacoDiffView'),
  ])
    .then(([, diffViewModule]) => diffViewModule)
    .catch((error: unknown) => {
      diffViewPromise = null
      throw error
    })

  return diffViewPromise
}

export function scheduleWorkspaceMonacoPreload() {
  if (backgroundPreloadScheduled || typeof window === 'undefined') {
    return
  }

  backgroundPreloadScheduled = true
  void preloadWorkspaceMonacoEditorView().catch(() => undefined)
}
