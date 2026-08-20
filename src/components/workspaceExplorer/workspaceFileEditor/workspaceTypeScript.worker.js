import { initialize } from 'monaco-editor/esm/vs/common/initialize.js'
import { TypeScriptWorker } from 'monaco-editor/esm/vs/language/typescript/tsWorker.js'
import { typescript } from 'monaco-editor/esm/vs/language/typescript/lib/typescriptServices.js'

const WORKSPACE_URI_ROOT = 'file://workspace'
const TYPESCRIPT_WORKSPACE_ROOT = '/workspace'
const WORKSPACE_URI_PATTERN = /^(?:file:\/\/workspace|file:\/\/\/workspace|file:\/workspace)\/+(.*)$/iu

function normalizeSlashes(value) {
  return String(value ?? '').replace(/\\/gu, '/')
}

function decodeWorkspaceRelativePath(fileName) {
  const match = WORKSPACE_URI_PATTERN.exec(normalizeSlashes(fileName))
  if (!match) return null

  try {
    return match[1]
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
      .join('/')
  } catch {
    return null
  }
}

function toTypeScriptWorkspacePath(fileName) {
  const normalized = normalizeSlashes(fileName)
  if (normalized === TYPESCRIPT_WORKSPACE_ROOT || normalized.startsWith(TYPESCRIPT_WORKSPACE_ROOT + '/')) {
    return normalized
  }

  const relativePath = decodeWorkspaceRelativePath(normalized)
  return relativePath === null
    ? normalized
    : TYPESCRIPT_WORKSPACE_ROOT + (relativePath ? '/' + relativePath : '')
}

function toWorkspaceUri(fileName) {
  const normalized = normalizeSlashes(fileName)
  const existingRelativePath = decodeWorkspaceRelativePath(normalized)
  const relativePath = existingRelativePath ?? (
    normalized === TYPESCRIPT_WORKSPACE_ROOT
      ? ''
      : normalized.startsWith(TYPESCRIPT_WORKSPACE_ROOT + '/')
        ? normalized.slice(TYPESCRIPT_WORKSPACE_ROOT.length + 1)
        : null
  )
  if (relativePath === null) return normalized

  const encodedPath = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return WORKSPACE_URI_ROOT + (encodedPath ? '/' + encodedPath : '')
}

function toResolverCompilerOptions(options) {
  const mapped = { ...options }
  for (const optionName of ['baseUrl', 'rootDir', 'pathsBasePath']) {
    if (typeof mapped[optionName] === 'string') {
      mapped[optionName] = toTypeScriptWorkspacePath(mapped[optionName])
    }
  }
  for (const optionName of ['rootDirs', 'typeRoots']) {
    if (Array.isArray(mapped[optionName])) {
      mapped[optionName] = mapped[optionName].map((entry) =>
        typeof entry === 'string' ? toTypeScriptWorkspacePath(entry) : entry,
      )
    }
  }
  return mapped
}

function mapResolvedModule(resolvedModule) {
  if (!resolvedModule) return undefined
  return {
    ...resolvedModule,
    resolvedFileName: toWorkspaceUri(resolvedModule.resolvedFileName),
  }
}

function mapResolvedTypeReference(resolvedTypeReferenceDirective) {
  if (!resolvedTypeReferenceDirective) return undefined
  return {
    ...resolvedTypeReferenceDirective,
    resolvedFileName: toWorkspaceUri(resolvedTypeReferenceDirective.resolvedFileName),
  }
}

function prettifyWorkspaceDisplayText(text) {
  return String(text).replace(
    /file:\/\/(?:\/)?workspace\/+([^"'\s]*)/giu,
    (_match, encodedPath) => {
      try {
        return decodeURIComponent(encodedPath).replace(/^\/+/u, '')
      } catch {
        return encodedPath.replace(/^\/+/u, '')
      }
    },
  )
}

class TideCodeTypeScriptWorker extends TypeScriptWorker {
  getCurrentDirectory() {
    return TYPESCRIPT_WORKSPACE_ROOT
  }

  _getScriptText(fileName) {
    return super._getScriptText(toWorkspaceUri(fileName))
  }

  getScriptVersion(fileName) {
    return super.getScriptVersion(toWorkspaceUri(fileName))
  }

  resolveModuleNames(moduleNames, containingFile, _reusedNames, redirectedReference, options, containingFileMode) {
    const containingTypeScriptPath = toTypeScriptWorkspacePath(containingFile)
    const compilerOptions = toResolverCompilerOptions(options ?? this.getCompilationSettings())
    return moduleNames.map((moduleName) => {
      const resolution = typescript.resolveModuleName(
        moduleName,
        containingTypeScriptPath,
        compilerOptions,
        this,
        undefined,
        redirectedReference,
        containingFileMode,
      )
      return mapResolvedModule(resolution.resolvedModule)
    })
  }

  resolveTypeReferenceDirectives(typeDirectiveNames, containingFile, redirectedReference, options, containingFileMode) {
    const containingTypeScriptPath = toTypeScriptWorkspacePath(containingFile)
    const compilerOptions = toResolverCompilerOptions(options ?? this.getCompilationSettings())
    return typeDirectiveNames.map((typeDirectiveName) => {
      const resolution = typescript.resolveTypeReferenceDirective(
        typeDirectiveName,
        containingTypeScriptPath,
        compilerOptions,
        this,
        redirectedReference,
        undefined,
        containingFileMode,
      )
      return mapResolvedTypeReference(resolution.resolvedTypeReferenceDirective)
    })
  }

  async getQuickInfoAtPosition(fileName, position) {
    const info = await super.getQuickInfoAtPosition(fileName, position)
    if (!info?.displayParts) return info

    return {
      ...info,
      displayParts: info.displayParts.map((part) => ({
        ...part,
        text: prettifyWorkspaceDisplayText(part.text),
      })),
    }
  }
}

self.onmessage = () => {
  initialize((ctx, createData) => new TideCodeTypeScriptWorker(ctx, createData))
}

export {
  TideCodeTypeScriptWorker,
  toTypeScriptWorkspacePath,
  toWorkspaceUri,
}
