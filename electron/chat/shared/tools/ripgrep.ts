import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRipgrepFallback } from './ripgrepFallback'

const RIPGREP_EXECUTABLE_NAME = process.platform === 'win32' ? 'rg.exe' : 'rg'
const require = createRequire(import.meta.url)
const MODULE_DIRECTORY_PATH = path.dirname(fileURLToPath(import.meta.url))

let ripgrepCommandCandidatesPromise: Promise<string[]> | null = null

class RipgrepBinaryNotFoundError extends Error {
  attemptedCommands: string[]

  constructor(attemptedCommands: string[], failures: string[]) {
    const failureSummary = failures.length > 0 ? ` Errors: ${failures.join(' | ')}` : ''
    super(`Ripgrep binary is unavailable. Tried: ${attemptedCommands.join(', ') || 'no candidate paths'}.${failureSummary}`)
    this.attemptedCommands = attemptedCommands
    this.name = 'RipgrepBinaryNotFoundError'
  }
}

interface ResolveRipgrepCommandCandidatesOptions {
  currentWorkingDirectory?: string | null
  isPackagedApp?: boolean
  executablePath?: string | null
  pathExistsImpl?: typeof pathExists
  requireResolveImpl?: typeof require.resolve
  resourcesPath?: string | null
}

async function pathExists(candidatePath: string) {
  try {
    await fs.access(candidatePath)
    return true
  } catch {
    return false
  }
}

function resetRipgrepCommandCandidatesCache() {
  ripgrepCommandCandidatesPromise = null
}

function normalizeResourcesRoot(candidatePath: string) {
  const normalizedCandidatePath = path.normalize(candidatePath.trim())
  if (normalizedCandidatePath.length === 0) {
    return normalizedCandidatePath
  }

  const baseName = path.basename(normalizedCandidatePath).toLowerCase()
  if (baseName === 'app.asar' || baseName === 'app.asar.unpacked') {
    return path.dirname(normalizedCandidatePath)
  }

  return normalizedCandidatePath
}

function resolveConfiguredResourcesPath(options: ResolveRipgrepCommandCandidatesOptions) {
  const environmentResourcesPath = process.env.TIDECODE_RESOURCES_PATH?.trim()
  return options.resourcesPath ??
    (environmentResourcesPath ? environmentResourcesPath : null) ??
    (typeof process.resourcesPath === 'string' && process.resourcesPath.trim().length > 0
      ? process.resourcesPath
      : null)
}

function isPackagedRuntime(options: ResolveRipgrepCommandCandidatesOptions = {}) {
  if (typeof options.isPackagedApp === 'boolean') {
    return options.isPackagedApp
  }

  const candidateResourcesPath = resolveConfiguredResourcesPath(options)

  if (candidateResourcesPath) {
    return true
  }

  if (typeof process.defaultApp === 'boolean') {
    return !process.defaultApp
  }

  return false
}

function resolveCanonicalRipgrepPath(options: ResolveRipgrepCommandCandidatesOptions = {}) {
  const isPackagedApp = isPackagedRuntime(options)
  if (isPackagedApp) {
    const candidateResourcesPath = resolveConfiguredResourcesPath(options)

    const packagedResourcesRoot = candidateResourcesPath ? normalizeResourcesRoot(candidateResourcesPath) : null
    if (packagedResourcesRoot) {
      return path.join(packagedResourcesRoot, 'ripgrep', RIPGREP_EXECUTABLE_NAME)
    }

    const executablePath =
      options.executablePath ?? (typeof process.execPath === 'string' && process.execPath.trim().length > 0 ? process.execPath : null)
    if (executablePath) {
      return path.join(path.dirname(path.normalize(executablePath)), 'resources', 'ripgrep', RIPGREP_EXECUTABLE_NAME)
    }

    return null
  }

  const currentWorkingDirectory =
    options.currentWorkingDirectory ?? (typeof process.cwd === 'function' ? process.cwd() : null)
  return currentWorkingDirectory ? path.join(currentWorkingDirectory, 'resources', 'ripgrep', RIPGREP_EXECUTABLE_NAME) : null
}

function resolveBundledRipgrepPath() {
  return path.resolve(MODULE_DIRECTORY_PATH, '../../../../resources/ripgrep', RIPGREP_EXECUTABLE_NAME)
}

function resolvePackageRipgrepPath(resolveImpl: typeof require.resolve = require.resolve) {
  try {
    return path.join(path.dirname(resolveImpl('@vscode/ripgrep/package.json')), 'bin', RIPGREP_EXECUTABLE_NAME)
  } catch {
    return null
  }
}

async function buildRipgrepCommandCandidates(options: ResolveRipgrepCommandCandidatesOptions = {}) {
  const pathExistsImpl = options.pathExistsImpl ?? pathExists
  const requireResolveImpl = options.requireResolveImpl ?? require.resolve
  const candidatePaths = [
    resolveCanonicalRipgrepPath(options),
    resolveBundledRipgrepPath(),
    resolvePackageRipgrepPath(requireResolveImpl),
  ].filter((candidatePath): candidatePath is string => Boolean(candidatePath))
  const uniqueCandidatePaths = [...new Set(candidatePaths)]
  const commands: string[] = []

  for (const candidatePath of uniqueCandidatePaths) {
    if (await pathExistsImpl(candidatePath)) {
      commands.push(candidatePath)
    }
  }

  commands.push(RIPGREP_EXECUTABLE_NAME)
  return [...new Set(commands)]
}

async function resolveRipgrepCommandCandidates() {
  if (!ripgrepCommandCandidatesPromise) {
    ripgrepCommandCandidatesPromise = buildRipgrepCommandCandidates()
  }

  return ripgrepCommandCandidatesPromise
}

function isRetryableRipgrepSpawnError(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) {
    return false
  }

  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'EACCES'
}

export async function runRipgrepWithCandidates(
  args: string[],
  cwd: string,
  candidateCommands: string[],
  spawnImpl: typeof spawn = spawn,
) {
  const attemptedCommands: string[] = []
  const failures: string[] = []

  for (const candidateCommand of candidateCommands) {
    attemptedCommands.push(candidateCommand)

    try {
      const result = await new Promise<{ exitCode: number; stderr: string; stdout: string }>((resolve, reject) => {
        const child = spawnImpl(candidateCommand, args, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })

        let stdout = ''
        let stderr = ''

        child.stdout.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString()
        })
        child.stderr.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString()
        })
        child.on('error', reject)
        child.on('close', (code) => {
          resolve({
            exitCode: code ?? 1,
            stderr,
            stdout,
          })
        })
      })

      return result
    } catch (error) {
      if (isRetryableRipgrepSpawnError(error)) {
        failures.push(`${candidateCommand}: ${error.code}`)
        continue
      }

      throw error
    }
  }

  throw new RipgrepBinaryNotFoundError(attemptedCommands, failures)
}

export async function runRipgrep(args: string[], cwd: string) {
  try {
    return await runRipgrepWithCandidates(args, cwd, await resolveRipgrepCommandCandidates())
  } catch (error) {
    if (!(error instanceof RipgrepBinaryNotFoundError)) {
      throw error
    }

    resetRipgrepCommandCandidatesCache()
    try {
      return await runRipgrepWithCandidates(args, cwd, await resolveRipgrepCommandCandidates())
    } catch (retryError) {
      if (!(retryError instanceof RipgrepBinaryNotFoundError)) {
        throw retryError
      }

      return runRipgrepFallback(args, cwd)
    }
  }
}

export const __testOnly = {
  buildRipgrepCommandCandidates,
  resolveCanonicalRipgrepPath,
  runRipgrepFallback,
  runRipgrepWithCandidates,
}
