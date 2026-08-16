import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TideCodeRunServiceClient } from './client'

let sharedClientPromise: Promise<TideCodeRunServiceClient> | null = null

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function isElectronRuntime() {
  return Boolean(process.versions.electron)
}

function getServiceLaunch() {
  const explicitEntry = process.env.TIDECODE_RUN_SERVICE_ENTRY?.trim()
  if (explicitEntry) {
    return {
      executable: process.execPath,
      args: [explicitEntry],
      env: isElectronRuntime() ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    }
  }

  const argvEntry = process.argv[1] ? path.resolve(process.argv[1]) : ''
  if (argvEntry) {
    const siblingService = path.join(path.dirname(argvEntry), 'run-service.mjs')
    if (existsSync(siblingService)) {
      return {
        executable: process.execPath,
        args: [siblingService],
        env: isElectronRuntime() ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      }
    }
  }

  const cwdSourceEntry = path.join(process.cwd(), 'electron', 'runService', 'index.ts')
  if (existsSync(cwdSourceEntry)) {
    return {
      executable: process.execPath,
      args: ['--import', 'tsx', cwdSourceEntry],
      env: isElectronRuntime() ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    }
  }

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const cliDirectory = path.join(resourcesPath, 'cli')
    const serviceEntry = path.join(cliDirectory, 'run-service.mjs')
    const nodeExecutable = path.join(cliDirectory, process.platform === 'win32' ? 'node.exe' : 'node')
    if (existsSync(serviceEntry) && existsSync(nodeExecutable)) {
      return { executable: nodeExecutable, args: [serviceEntry], env: process.env }
    }
  }

  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(moduleDirectory, '..', '..')
  const sourceEntry = path.join(projectRoot, 'electron', 'runService', 'index.ts')
  return {
    executable: process.execPath,
    args: ['--import', 'tsx', sourceEntry],
    env: isElectronRuntime() ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
  }
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
