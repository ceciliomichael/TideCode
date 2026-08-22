import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export interface VenvInfo {
  name: string
  relativePath: string
  venvPath: string
}

/**
 * Returns true when `dirPath` contains a `pyvenv.cfg` file — the standard
 * marker for a Python virtual environment created by `python -m venv`.
 */
export function hasPyvenvCfg(dirPath: string): boolean {
  return existsSync(path.join(dirPath, 'pyvenv.cfg'))
}

/**
 * Walk upward from `cwd` looking for a Python virtual environment.
 *
 * Detects any directory containing a `pyvenv.cfg` file — the standard marker
 * that Python's `venv` module generates, regardless of what the directory is
 * named (`venv`, `.venv`, `env`, `sandbox`, etc.). Stops at the workspace
 * root or filesystem root.
 */
export function findVenvPath(cwd: string, workspaceRootPath: string | null): string | null {
  const normalizedCwd = path.normalize(cwd)
  const boundary = workspaceRootPath
    ? path.normalize(workspaceRootPath)
    : path.parse(normalizedCwd).root

  let currentDir = normalizedCwd
  while (currentDir.length >= boundary.length) {
    // Check if this directory itself is a venv (has pyvenv.cfg inside it)
    if (hasPyvenvCfg(currentDir)) {
      return currentDir
    }

    // Also check immediate subdirectories for pyvenv.cfg for the common pattern
    // where cwd is the workspace root and venv is a child dir like ./venv
    try {
      const entries = readdirSync(currentDir, { encoding: 'utf-8' })
      for (const name of entries) {
        const candidate = path.join(currentDir, name)
        try {
          if (statSync(candidate).isDirectory() && hasPyvenvCfg(candidate)) {
            return candidate
          }
        } catch (_) {
          // skip entries we can't stat
        }
      }
    } catch (_) {
      // Permission errors on currentDir — skip
    }

    if (currentDir === boundary) {
      break
    }

    const parent = path.dirname(currentDir)
    if (parent === currentDir) {
      break // filesystem root
    }
    currentDir = parent
  }

  return null
}

/**
 * Set VIRTUAL_ENV and prepend the venv's bin/Scripts directory to PATH so the
 * terminal behaves as if the venv had been activated via the activate script.
 */
export function activateVenvInEnvironment(
  env: NodeJS.ProcessEnv,
  venvPath: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const isWindows = platform === 'win32'
  const venvBin = isWindows
    ? path.join(venvPath, 'Scripts')
    : path.join(venvPath, 'bin')
  const pathSeparator = isWindows ? ';' : ':'
  const pathKey = isWindows
    ? Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path'
    : 'PATH'
  const existingPath = env[pathKey] ?? ''
  const prependedPath = existingPath.length > 0
    ? `${venvBin}${pathSeparator}${existingPath}`
    : venvBin

  return {
    ...env,
    [pathKey]: prependedPath,
    VIRTUAL_ENV: venvPath,
  }
}

/**
 * Detect Python virtual environment metadata for a workspace root.
 */
export function detectVenvInfo(workspaceRootPath: string, cwd?: string): VenvInfo | null {
  const searchDir = cwd ? cwd : workspaceRootPath
  const venvPath = findVenvPath(searchDir, workspaceRootPath)
  if (!venvPath) {
    return null
  }

  const name = path.basename(venvPath)
  const relPathRaw = path.relative(workspaceRootPath, venvPath)
  const relativePath = relPathRaw ? relPathRaw.replace(/\\/g, '/') : name

  return {
    name,
    relativePath,
    venvPath,
  }
}

/**
 * Formats a short prompt text notifying the AI about the active Python virtual environment.
 */
export function buildPythonVenvPromptBlock(workspaceRootPath: string, cwd?: string): string | null {
  const info = detectVenvInfo(workspaceRootPath, cwd)
  if (!info) {
    return null
  }

  if (info.relativePath !== info.name && info.relativePath !== '.') {
    return `Python virtual environment activated: ${info.name} (${info.relativePath})`
  }

  return `Python virtual environment activated: ${info.name}`
}
