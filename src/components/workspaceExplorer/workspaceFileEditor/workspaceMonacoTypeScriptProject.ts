import type { Monaco } from '@monaco-editor/react'
import type { editor, IDisposable } from 'monaco-editor'
import type { WorkspaceTypeScriptProjectSnapshot } from '../../../types/chat'
import { normalizeWorkspaceRootPathForComparison } from '../../../lib/workspaceRootPathComparison'
import {
  createWorkspaceMonacoModelPath,
  createWorkspaceMonacoTypeScriptFilePath,
} from './workspaceMonacoConfig'
import { createWorkspaceMonacoTypeScriptCompilerOptions } from './workspaceMonacoTypeScriptConfig'

export type WorkspaceMonacoScriptLanguage = 'javascript' | 'typescript'

type LanguageServiceDefaults = Monaco['languages']['typescript']['typescriptDefaults']

interface ExtraLibRegistration {
  content: string
  disposable: IDisposable
}

interface AppliedProjectState {
  compilerOptionsKey: string
  diagnosticsStateKey: string
  extraLibs: Map<string, ExtraLibRegistration>
  fileContents: Map<string, string>
  hydratedFilePaths: Set<string>
  projectKey: string
  workspaceKey: string
}

interface ApplyWorkspaceMonacoTypeScriptProjectOptions {
  activeFilePath?: string
  replaceMissing?: boolean
  semanticReady?: boolean
}

const appliedProjectStates = new WeakMap<object, Map<WorkspaceMonacoScriptLanguage, AppliedProjectState>>()

export function getWorkspaceMonacoScriptLanguage(language: string): WorkspaceMonacoScriptLanguage | null {
  if (language === 'typescript') return 'typescript'
  if (language === 'javascript') return 'javascript'
  return null
}

function getLanguageDefaults(monaco: Monaco, language: WorkspaceMonacoScriptLanguage): LanguageServiceDefaults {
  return language === 'typescript'
    ? monaco.languages.typescript.typescriptDefaults
    : monaco.languages.typescript.javascriptDefaults
}

function getOpenModelUris(monaco: Monaco) {
  return new Set(monaco.editor.getModels().map((model: editor.ITextModel) => model.uri.toString()))
}

function getStateMap(monaco: Monaco) {
  let stateMap = appliedProjectStates.get(monaco as unknown as object)
  if (!stateMap) {
    stateMap = new Map()
    appliedProjectStates.set(monaco as unknown as object, stateMap)
  }
  return stateMap
}

function disposeExtraLibs(state: AppliedProjectState) {
  for (const registration of state.extraLibs.values()) {
    registration.disposable.dispose()
  }
  state.extraLibs.clear()
  state.fileContents.clear()
}

function createProjectState(workspaceKey: string, projectKey: string): AppliedProjectState {
  return {
    compilerOptionsKey: '',
    diagnosticsStateKey: '',
    extraLibs: new Map(),
    fileContents: new Map(),
    hydratedFilePaths: new Set(),
    projectKey,
    workspaceKey,
  }
}

function normalizeProjectRelativePath(filePath: string) {
  return filePath.trim().replace(/\\/gu, '/').replace(/^\.\/+/u, '')
}

export function hasWorkspaceMonacoTypeScriptWorkspace(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
  workspaceRootPath: string,
) {
  const state = appliedProjectStates.get(monaco as unknown as object)?.get(language)
  if (!state) return false
  return state.workspaceKey === normalizeWorkspaceRootPathForComparison(workspaceRootPath)
}

export function getWorkspaceMonacoTypeScriptProjectFileContent(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
  fileUri: string,
) {
  return appliedProjectStates.get(monaco as unknown as object)?.get(language)?.fileContents.get(fileUri) ?? null
}

export function isWorkspaceMonacoTypeScriptFileHydrated(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
  workspaceRootPath: string,
  filePath: string,
) {
  const state = appliedProjectStates.get(monaco as unknown as object)?.get(language)
  if (!state) return false
  return state.workspaceKey === normalizeWorkspaceRootPathForComparison(workspaceRootPath) &&
    state.hydratedFilePaths.has(normalizeProjectRelativePath(filePath))
}

export function suspendWorkspaceMonacoTypeScriptDiagnostics(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
  workspaceRootPath?: string | null,
) {
  if (
    workspaceRootPath?.trim() &&
    hasWorkspaceMonacoTypeScriptWorkspace(monaco, language, workspaceRootPath)
  ) {
    return
  }

  const defaults = getLanguageDefaults(monaco, language)
  defaults.setEagerModelSync(true)
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSuggestionDiagnostics: false,
    noSyntaxValidation: false,
    onlyVisible: true,
  })
}

export function applyWorkspaceMonacoTypeScriptProject(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
  workspaceRootPath: string,
  snapshot: WorkspaceTypeScriptProjectSnapshot,
  options: ApplyWorkspaceMonacoTypeScriptProjectOptions = {},
) {
  const defaults = getLanguageDefaults(monaco, language)
  const stateMap = getStateMap(monaco)
  const workspaceKey = normalizeWorkspaceRootPathForComparison(workspaceRootPath)
  let state = stateMap.get(language)

  if (!state || state.workspaceKey !== workspaceKey || state.projectKey !== snapshot.projectKey) {
    if (state) {
      disposeExtraLibs(state)
    }
    state = createProjectState(workspaceKey, snapshot.projectKey)
    stateMap.set(language, state)
  }

  if (options.replaceMissing) {
    state.hydratedFilePaths.clear()
  }

  const openModelUris = getOpenModelUris(monaco)
  const nextFileUris = new Set<string>()
  const nextFileContentUris = new Set<string>()
  const compilerOptions = createWorkspaceMonacoTypeScriptCompilerOptions(snapshot)
  if (language === 'javascript') {
    compilerOptions.allowJs = true
  }

  defaults.setEagerModelSync(true)

  for (const file of snapshot.files) {
    const modelUri = createWorkspaceMonacoModelPath(file.filePath)
    const workerFilePath = createWorkspaceMonacoTypeScriptFilePath(file.filePath)
    nextFileContentUris.add(modelUri)
    nextFileContentUris.add(workerFilePath)
    state.fileContents.set(modelUri, file.content)
    state.fileContents.set(workerFilePath, file.content)

    const registrationPaths = new Set([workerFilePath])
    if (!file.filePath.startsWith('node_modules/') && modelUri !== workerFilePath) {
      registrationPaths.add(modelUri)
    }

    for (const fileUri of registrationPaths) {
      nextFileUris.add(fileUri)
      const existing = state.extraLibs.get(fileUri)
      if (openModelUris.has(fileUri)) {
        existing?.disposable.dispose()
        state.extraLibs.delete(fileUri)
        continue
      }
      if (existing?.content === file.content) {
        continue
      }

      existing?.disposable.dispose()
      state.extraLibs.set(fileUri, {
        content: file.content,
        disposable: defaults.addExtraLib(file.content, fileUri),
      })
    }
  }

  if (options.replaceMissing) {
    for (const [fileUri, registration] of Array.from(state.extraLibs.entries())) {
      if (nextFileUris.has(fileUri)) continue
      registration.disposable.dispose()
      state.extraLibs.delete(fileUri)
    }
    for (const fileUri of Array.from(state.fileContents.keys())) {
      if (!nextFileContentUris.has(fileUri)) {
        state.fileContents.delete(fileUri)
      }
    }
  }

  const compilerOptionsKey = JSON.stringify(compilerOptions)
  if (state.compilerOptionsKey !== compilerOptionsKey) {
    defaults.setCompilerOptions(compilerOptions)
    state.compilerOptionsKey = compilerOptionsKey
  }

  const semanticReady = options.semanticReady !== false
  const diagnosticsStateKey = String(snapshot.truncated) + ':' + String(semanticReady)
  if (state.diagnosticsStateKey !== diagnosticsStateKey) {
    defaults.setDiagnosticsOptions({
      noSemanticValidation: snapshot.truncated || !semanticReady,
      noSuggestionDiagnostics: false,
      noSyntaxValidation: false,
      onlyVisible: true,
    })
    state.diagnosticsStateKey = diagnosticsStateKey
  }

  if (semanticReady && options.activeFilePath?.trim()) {
    state.hydratedFilePaths.add(normalizeProjectRelativePath(options.activeFilePath))
  }
}

export function clearWorkspaceMonacoTypeScriptProject(
  monaco: Monaco,
  language: WorkspaceMonacoScriptLanguage,
) {
  const defaults = getLanguageDefaults(monaco, language)
  const stateMap = appliedProjectStates.get(monaco as unknown as object)
  const state = stateMap?.get(language)
  if (state) {
    disposeExtraLibs(state)
    stateMap?.delete(language)
  }
  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSuggestionDiagnostics: false,
    noSyntaxValidation: false,
    onlyVisible: true,
  })
}
