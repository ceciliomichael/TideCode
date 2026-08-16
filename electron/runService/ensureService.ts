import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../runtime/runtimeRoot'
import { TideCodeRunServiceClient } from './client'

let sharedClientPromise: Promise<TideCodeRunServiceClient> | null = null

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function isElectronRuntime() {
  return Boolean(process.versions.electron)
}

export function buildRunServiceEnvironment(runtimeRoot: string, electronRunAsNode: boolean) {
  return {
    ...process.env,
    TIDECODE_RUNTIME_ROOT: path.resolve(runtimeRoot),
    ...(electronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
}

export function getPackagedRunServiceLaunch(resourcesPath: string) {
  const cliDirectory = path.join(resourcesPath, 'cli')
  const serviceEntry = path.join(cliDirectory, 'run-service.mjs')
  const nodeExecutable = path.join(cliDirectory, process.platform === 'win32' ? 'node.exe' : 'node')
  if (!existsSync(serviceEntry) || !existsSync(nodeExecutable)) return null

  return {
    executable: nodeExecutable,
    args: [serviceEntry],
    env: buildRunServiceEnvironment(cliDirectory, false),
  }
}

function getServiceLaunch() {
  const hostRuntimeRoot = getTideCodeRuntimeRoot()
  const explicitEntry = process.env.TIDECODE_RUN_SERVICE_ENTRY?.trim()
  if (explicitEntry) {
    const explicitRuntimeRoot = process.env.TIDECODE_RUN_SERVICE_RUNTIME_ROOT?.trim()
    if (!explicitRuntimeRoot) {
      throw new Error('TIDECODE_RUN_SERVICE_RUNTIME_ROOT is required with TIDECODE_RUN_SERVICE_ENTRY.')
    }
    return {
      executable: process.execPath,
      args: [explicitEntry],
      env: buildRunServiceEnvironment(explicitRuntimeRoot, isElectronRuntime()),
    }
  }

  const argvEntry = process.argv[1] ? path.resolve(process.argv[1]) : ''
  if (argvEntry) {
    const runtimeDirectory = path.dirname(argvEntry)
    const siblingService = path.join(runtimeDirectory, 'run-service.mjs')
    if (existsSync(siblingService)) {
      return {
        executable: process.execPath,
        args: [siblingService],
        env: buildRunServiceEnvironment(runtimeDirectory, isElectronRuntime()),
      }
    }
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const packagedLaunch = getPackagedRunServiceLaunch(resourcesPath)
    if (packagedLaunch) return packagedLaunch
  }

  const sourceEntry = path.join(hostRuntimeRoot, 'electron', 'runService', 'index.ts')
  if (existsSync(sourceEntry)) {
    return {
      executable: process.execPath,
      args: ['--import', 'tsx', sourceEntry],
      env: buildRunServiceEnvironment(hostRuntimeRoot, isElectronRuntime()),
    }
  }

  throw new Error('Unable to locate the TideCode run service from the configured runtime root.')
}

async function connectExistingService() {
  const client = new TideCodeRunServiceClient()
  await client.connect()
  return client
}

async function launchAndConnectService() {
  try {
    return await connectExistingService()
  } catch {
    // No shared service is currently reachable. Starting more than one process
    // is safe because only one can bind the deterministic local endpoint.
  }

  const launch = getServiceLaunch()
  const child = spawn(launch.executable, launch.args, {
    cwd: process.cwd(),
    detached: true,
    env: launch.env,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()

  let lastError: unknown = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(50)
    try {
      return await connectExistingService()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to start the Tidecode run service.')
}

export function ensureRunServiceClient() {
  if (!sharedClientPromise) {
    sharedClientPromise = launchAndConnectService().catch((error) => {
      sharedClientPromise = null
      throw error
    })
  }
  return sharedClientPromise
}

export function resetRunServiceClientForTests() {
  sharedClientPromise = null
}
