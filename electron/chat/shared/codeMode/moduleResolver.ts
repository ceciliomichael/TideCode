import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolve as resolveImportMeta } from 'import-meta-resolve'

function workspaceModuleBaseUrl(workspaceRootPath: string) {
  return pathToFileURL(path.join(workspaceRootPath, '.tidecode-code-mode-entry.mjs')).href
}

export function resolveCodeModeEsmSpecifier(specifier: string, workspaceRootPath: string) {
  if (typeof specifier !== 'string' || specifier.length === 0) {
    throw new Error('Code Mode import requires a non-empty module specifier.')
  }

  try {
    return resolveImportMeta(specifier, workspaceModuleBaseUrl(workspaceRootPath))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Code Mode could not resolve ES module ${JSON.stringify(specifier)} from the selected workspace: ${message}`)
  }
}
