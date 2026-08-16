import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureTideCodeRuntimeRoot } from '../runtime/runtimeRoot'

export function resolveCliAppRoot(moduleUrl = import.meta.url) {
  const moduleDirectory = path.dirname(fileURLToPath(moduleUrl))
  const parentDirectoryName = path.basename(path.dirname(moduleDirectory))

  if (parentDirectoryName === 'electron' || parentDirectoryName === 'dist-electron') {
    return path.resolve(moduleDirectory, '..', '..')
  }

  return moduleDirectory
}

export function initializeCliAppRoot(moduleUrl = import.meta.url) {
  const runtimeRoot = configureTideCodeRuntimeRoot(resolveCliAppRoot(moduleUrl))
  const configuredRoot = process.env.APP_ROOT?.trim()
  if (configuredRoot) return configuredRoot

  process.env.APP_ROOT = runtimeRoot
  return runtimeRoot
}
