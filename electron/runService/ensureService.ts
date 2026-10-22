import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../runtime/runtimeRoot'
import {
  computeRunServiceBuildId,
  computeSourceRunServiceBuildId,
  RUN_SERVICE_BUILD_ID_ENV,
} from './buildIdentity'
import { RunServiceBuildMismatchError, TideCodeRunServiceClient } from './client'
import { configureDevelopmentRunServiceNamespace, resolveRunServiceNamespace } from './namespace'
import { registerDesktopBrowserHostIfConfigured } from './desktopBrowserHostConnection'
import { getRunServiceEndpoint } from './paths'

let sharedClientPromise: Promise<TideCodeRunServiceClient> | null = null
let existingServiceProbe: Promise<TideCodeRunServiceClient | null> | null = null
let runServiceShutdownRequested = false
let cachedServiceLaunch: ReturnType<typeof getServiceLaunch> | null = null

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
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

function getCachedServiceLaunch() {
  cachedServiceLaunch ??= getServiceLaunch()
  return cachedServiceLaunch
}

async function connectExistingService(buildId: string) {
  const client = new TideCodeRunServiceClient(buildId)
  try {
    await client.connect()
    return client
  } catch (error) {
    client.close()
    throw error
  }
}

async function connectExistingRunServiceIfAvailable() {
  configureRunServiceNamespaceForRuntime()
  const launch = getCachedServiceLaunch()
  try {
    return await connectExistingService(launch.buildId)
  } catch {
    return null
  }
}

async function waitForStaleServiceExit(buildId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(50)
    try {
      return await connectExistingService(buildId)
    } catch (error) {
      rejectDeniedRunServiceConnection(error)
      if (error instanceof RunServiceBuildMismatchError) continue
      return null
    }
  }
  return null
}

function rejectDeniedRunServiceConnection(error: unknown) {
  const connectionError = error as NodeJS.ErrnoException | null
  if (process.platform !== 'win32' || connectionError?.syscall !== 'connect') {
    return
  }
  if (connectionError.code !== 'EPERM' && connectionError.code !== 'EACCES') {
    return
  }

  const failure = new Error(`Windows denied access to the TideCode run-service pipe ${getRunServiceEndpoint()}. Close the background service that owns this pipe and restart TideCode from a terminal with the same Windows security level.`)
  Object.assign(failure, { code: connectionError.code, cause: error })
  throw failure
}

async function launchAndConnectService() {
  configureRunServiceNamespaceForRuntime()
  const launch = getCachedServiceLaunch()
  try {
    return await connectExistingService(launch.buildId)
  } catch (error) {
    rejectDeniedRunServiceConnection(error)
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
      return client
    } catch (error) {
      rejectDeniedRunServiceConnection(error)
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to start the Tidecode run service.')
}

export function ensureRunServiceClient(): Promise<TideCodeRunServiceClient> {
  if (runServiceShutdownRequested) {
    return Promise.reject(new Error('TideCode run service is shutting down.'))
  }
  if (!sharedClientPromise) {
    const pending = launchAndConnectService()
    const guarded = pending.catch((error) => {
      if (sharedClientPromise === guarded) sharedClientPromise = null
      throw error
    })
    sharedClientPromise = guarded
  }
  const observed = sharedClientPromise
  return observed.then(async (client) => {
    if (client.isConnected || runServiceShutdownRequested) return client
    if (sharedClientPromise !== observed) return sharedClientPromise!
    const stale = sharedClientPromise
    if (stale) {
      const replacement = launchAndConnectService()
      const guarded = replacement.catch((error) => {
        if (sharedClientPromise === guarded) sharedClientPromise = null
        throw error
      })
      if (sharedClientPromise === stale) sharedClientPromise = guarded
      return sharedClientPromise
    }
    return ensureRunServiceClient()
  }).then(async (client) => {
    try {
      await registerDesktopBrowserHostIfConfigured(client)
    } catch (error) {
      console.error('[browser] Failed to connect TideCode Desktop to browser service:', error)
    }
    return client
  })
}

export async function connectRunServiceClientIfAvailable() {
  if (runServiceShutdownRequested) {
    return null
  }
  if (sharedClientPromise) {
    return sharedClientPromise.catch(() => null)
  }

  if (!existingServiceProbe) {
    const probe = connectExistingRunServiceIfAvailable().finally(() => {
      if (existingServiceProbe === probe) {
        existingServiceProbe = null
      }
    })
    existingServiceProbe = probe
  }
  const client = await existingServiceProbe
  if (!client) {
    return null
  }
  if (runServiceShutdownRequested) {
    client.close()
    return null
  }

  const concurrentClientPromise = sharedClientPromise as Promise<TideCodeRunServiceClient> | null
  if (concurrentClientPromise) {
    const concurrentClient = await concurrentClientPromise.catch(() => null)
    if (concurrentClient !== client) {
      client.close()
    }
    return concurrentClient
  }

  sharedClientPromise = Promise.resolve(client)
  void registerDesktopBrowserHostIfConfigured(client).catch((error) => {
    console.error('[browser] Failed to attach desktop browser host:', error)
  })
  return client
}

export async function stopRunServiceWorkForApplication() {
  const client = await sharedClientPromise?.catch(() => null)
  if (client?.isConnected) {
    await client.stopApplicationRuns()
  }
}

export async function disconnectRunServiceForApplication() {
  runServiceShutdownRequested = true
  const clientPromise = sharedClientPromise
  sharedClientPromise = null

  if (!clientPromise) return
  const client = await clientPromise.catch(() => null)
  if (!client) return
  try {
    if (client.isConnected) {
      await client.stopApplicationRuns()
    }
  } finally {
    client.close()
  }
}

export function resetRunServiceClientForTests() {
  sharedClientPromise = null
  existingServiceProbe = null
  runServiceShutdownRequested = false
  cachedServiceLaunch = null
}
