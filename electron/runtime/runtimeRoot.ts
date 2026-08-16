import path from 'node:path'

const RUNTIME_ROOT_ENV = 'TIDECODE_RUNTIME_ROOT'

export function configureTideCodeRuntimeRoot(runtimeRoot: string) {
  const normalizedRoot = path.resolve(runtimeRoot)
  process.env[RUNTIME_ROOT_ENV] = normalizedRoot
  return normalizedRoot
}

export function getTideCodeRuntimeRoot() {
  const runtimeRoot = process.env[RUNTIME_ROOT_ENV]?.trim()
  if (!runtimeRoot) {
    throw new Error('TideCode runtime root is not configured.')
  }
  return runtimeRoot
}
