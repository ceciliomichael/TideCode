import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../runtime/runtimeRoot'
import {
  computeRunServiceBuildId,
  computeSourceRunServiceBuildId,
  RUN_SERVICE_BUILD_ID_ENV,
} from './buildIdentity'
import { RunServiceBuildMismatchError, TideCodeRunServiceClient } from './client'
import { configureDevelopmentRunServiceNamespace, resolveRunServiceNamespace } from './namespace'

let sharedClientPromise: Promise<TideCodeRunServiceClient> | null = null
let ownedRunServiceChild: ChildProcess | null = null
let runServiceShutdownRequested = false

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    sleep(timeoutMs).then(() => false),
  ])
}

async function forceTerminateRunServiceTree(child: ChildProcess) {
  const processId = child.pid
  if (!processId) return

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      let taskkill: ChildProcess
      try {
        taskkill = spawn('taskkill', ['/PID', String(processId), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } catch {
        resolve()
        return
      }
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve()
      }
      taskkill.once('error', finish)
      taskkill.once('exit', finish)
      const timeoutId = setTimeout(() => {
        taskkill.kill()
        finish()
      }, 2_000)
      timeoutId.unref?.()
    })
    return
  }

  try {
    process.kill(-processId, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function isElectronRuntime() {
  return Boolean(process.versions.electron)
}

function configureRunServiceNamespaceForRuntime() {
  const configuredNamespace = resolveRunServiceNamespace()
  if (configuredNamespace) return configuredNamespace

  const runtimeRoot = getTideCodeRuntimeRoot()
  const sourceEntry = path.join(runtimeRoot, 'electron', 'runService', 'index.ts')
  if (!existsSync(sourceEntry)) return null
  // A source/dev client must not replace the packaged service. That service may own the
  // terminal process tree which launched this very `npm run dev` command.
  return configureDevelopmentRunServiceNamespace(runtimeRoot)
}

export function buildRunServiceEnvironment(
  runtimeRoot: string,
  electronRunAsNode: boolean,
  buildId: string,
) {
  return {
    ...process.env,
    TIDECODE_RUNTIME_ROOT: path.resolve(runtimeRoot),
    [RUN_SERVICE_BUILD_ID_ENV]: buildId,
    ...(electronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }
}

export function getPackagedRunServiceLaunch(resourcesPath: string) {
  const cliDirectory = path.join(resourcesPath, 'cli')
  const serviceEntry = path.join(cliDirectory, 'run-service.mjs')
  const nodeExecutable = path.join(cliDirectory, process.platform === 'win32' ? 'node.exe' : 'node')
  if (!existsSync(serviceEntry) || !existsSync(nodeExecutable)) return null

  const buildId = computeRunServiceBuildId(serviceEntry)
  return {
    executable: nodeExecutable,
    args: [serviceEntry],
    buildId,
    env: buildRunServiceEnvironment(cliDirectory, false, buildId),
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
    const buildId = computeRunServiceBuildId(explicitEntry)
    return {
      executable: process.execPath,
      args: [explicitEntry],
      buildId,
      env: buildRunServiceEnvironment(explicitRuntimeRoot, isElectronRuntime(), buildId),
    }
  }

  const argvEntry = process.argv[1] ? path.resolve(process.argv[1]) : ''
  if (argvEntry) {
    const runtimeDirectory = path.dirname(argvEntry)
    const siblingService = path.join(runtimeDirectory, 'run-service.mjs')
    if (existsSync(siblingService)) {
      const buildId = computeRunServiceBuildId(siblingService)
      return {
        executable: process.execPath,
        args: [siblingService],
        buildId,
        env: buildRunServiceEnvironment(runtimeDirectory, isElectronRuntime(), buildId),
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
    const buildId = computeSourceRunServiceBuildId(hostRuntimeRoot)
    return {
      executable: process.execPath,
      args: ['--import', 'tsx', sourceEntry],
      buildId,
      env: buildRunServiceEnvironment(hostRuntimeRoot, isElectronRuntime(), buildId),
    }
  }

  throw new Error('Unable to locate the TideCode run service from the configured runtime root.')
}

async function connectExistingService(buildId: string) {
  const client = new TideCodeRunServiceClient(buildId)
  await client.connect()
  return client
}

async function waitForStaleServiceExit(buildId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(50)
    try {
      return await connectExistingService(buildId)
    } catch (error) {
      if (error instanceof RunServiceBuildMismatchError) continue
      return null
    }
  }
  return null
}

async function launchAndConnectService() {
  configureRunServiceNamespaceForRuntime()
  const launch = getServiceLaunch()
  try {
    return await connectExistingService(launch.buildId)
  } catch (error) {
    if (error instanceof RunServiceBuildMismatchError) {
      const replacement = await waitForStaleServiceExit(launch.buildId)
      if (replacement) return replacement
    }
    // No compatible shared service is currently reachable. Starting more than one process
    // is safe because only one can bind the deterministic local endpoint.
  }

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
      const client = await connectExistingService(launch.buildId)
      if (child.pid && client.processId === child.pid) {
        ownedRunServiceChild = child
      }
      return client
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to start the Tidecode run service.')
}

export function ensureRunServiceClient() {
  if (runServiceShutdownRequested) {
    return Promise.reject(new Error('TideCode run service is shutting down.'))
  }
  if (!sharedClientPromise) {
    sharedClientPromise = launchAndConnectService().catch((error) => {
      sharedClientPromise = null
      throw error
    })
  }
  return sharedClientPromise
}

export async function shutdownRunServiceForApplication() {
  runServiceShutdownRequested = true
  const clientPromise = sharedClientPromise
  const child = ownedRunServiceChild
  sharedClientPromise = null
  ownedRunServiceChild = null

  if (!clientPromise) return
  const client = await clientPromise.catch(() => null)
  if (!client) return

  if (!child?.pid || client.processId !== child.pid) {
    client.close()
    return
  }

  try {
    await client.shutdown()
    if (await waitForChildExit(child, 1_000)) return
  } catch (error) {
    await forceTerminateRunServiceTree(child)
    throw error
  }

  await forceTerminateRunServiceTree(child)
  await waitForChildExit(child, 1_000)
}

export function resetRunServiceClientForTests() {
  sharedClientPromise = null
  ownedRunServiceChild = null
  runServiceShutdownRequested = false
}
