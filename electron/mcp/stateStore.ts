import { promises as fs } from 'node:fs'
import path from 'node:path'
import { electronApp } from '../electronApp'

const CONFIG_ROOT_SEGMENTS = ['.tidecode', 'mcp'] as const
const STATE_FILENAME = 'state.json'
const GLOBAL_STATE_KEY = '__global__'

interface StoredServerState {
  autoConnect: boolean
}

interface StoredWorkspaceState {
  servers: Record<string, StoredServerState>
}

interface StoredStateFile {
  workspaces: Record<string, StoredWorkspaceState>
}

const DEFAULT_STATE_FILE: StoredStateFile = {
  workspaces: {},
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRootPath() {
  return path.join(electronApp.getPath('home'), ...CONFIG_ROOT_SEGMENTS)
}

function getGlobalStatePath() {
  return path.join(getRootPath(), STATE_FILENAME)
}

function getLegacyProjectStatePath(workspacePath: string) {
  return path.join(path.resolve(workspacePath), ...CONFIG_ROOT_SEGMENTS, STATE_FILENAME)
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const trimmed = workspacePath?.trim() ?? ''
  return trimmed.length > 0 ? path.resolve(trimmed) : null
}

function getWorkspaceStateKey(workspacePath?: string | null) {
  return normalizeWorkspacePath(workspacePath) ?? GLOBAL_STATE_KEY
}

async function ensureDirectory(targetPath: string) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
}

async function writeStateFile(targetPath: string, state: StoredStateFile) {
  await ensureDirectory(targetPath)
  await fs.writeFile(targetPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function sanitizeWorkspaceState(input: unknown): StoredWorkspaceState {
  if (!isPlainObject(input) || !isPlainObject(input.servers)) {
    return { servers: {} }
  }

  const sanitized: StoredWorkspaceState = { servers: {} }
  for (const [serverName, candidateState] of Object.entries(input.servers)) {
    if (!isPlainObject(candidateState) || typeof candidateState.autoConnect !== 'boolean') {
      continue
    }

    const normalizedName = serverName.trim()
    if (normalizedName.length === 0) {
      continue
    }

    sanitized.servers[normalizedName] = {
      autoConnect: candidateState.autoConnect,
    }
  }

  return sanitized
}

function sanitizeStateFile(input: unknown): StoredStateFile {
  if (!isPlainObject(input) || !isPlainObject(input.workspaces)) {
    return { ...DEFAULT_STATE_FILE }
  }

  const sanitized: StoredStateFile = { workspaces: {} }
  for (const [workspaceKey, candidateWorkspaceState] of Object.entries(input.workspaces)) {
    const normalizedWorkspaceKey = workspaceKey.trim()
    if (normalizedWorkspaceKey.length === 0) {
      continue
    }

    const sanitizedWorkspace = sanitizeWorkspaceState(candidateWorkspaceState)
    if (Object.keys(sanitizedWorkspace.servers).length === 0) {
      continue
    }

    sanitized.workspaces[normalizedWorkspaceKey] = sanitizedWorkspace
  }

  return sanitized
}

async function readStateFile(targetPath: string) {
  try {
    const raw = await fs.readFile(targetPath, 'utf8')
    return sanitizeStateFile(JSON.parse(raw) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_STATE_FILE }
    }

    throw error
  }
}

async function readLegacyWorkspaceState(workspacePath: string) {
  const legacyStatePath = getLegacyProjectStatePath(workspacePath)

  try {
    const raw = await fs.readFile(legacyStatePath, 'utf8')
    return sanitizeWorkspaceState(JSON.parse(raw) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function getWorkspaceState(stateFile: StoredStateFile, workspaceKey: string) {
  return stateFile.workspaces[workspaceKey] ?? null
}

function setWorkspaceState(stateFile: StoredStateFile, workspaceKey: string, workspaceState: StoredWorkspaceState) {
  stateFile.workspaces[workspaceKey] = workspaceState
}

function removeServerFromWorkspaceState(stateFile: StoredStateFile, workspaceKey: string, serverName: string) {
  const workspaceState = getWorkspaceState(stateFile, workspaceKey)
  if (!workspaceState || !workspaceState.servers[serverName]) {
    return
  }

  delete workspaceState.servers[serverName]
  if (Object.keys(workspaceState.servers).length === 0) {
    delete stateFile.workspaces[workspaceKey]
  }
}

async function migrateLegacyWorkspaceStateIfNeeded(workspacePath: string, stateFile: StoredStateFile) {
  const workspaceKey = getWorkspaceStateKey(workspacePath)
  if (stateFile.workspaces[workspaceKey]) {
    return
  }

  const legacyWorkspaceState = await readLegacyWorkspaceState(workspacePath)
  if (!legacyWorkspaceState || Object.keys(legacyWorkspaceState.servers).length === 0) {
    return
  }

  setWorkspaceState(stateFile, workspaceKey, legacyWorkspaceState)
  await writeStateFile(getGlobalStatePath(), stateFile)
}

async function ensureStateFileExists(targetPath: string) {
  try {
    await fs.access(targetPath)
  } catch {
    await writeStateFile(targetPath, { ...DEFAULT_STATE_FILE })
  }
}

export class McpStateStore {
  private globalStatePath = getGlobalStatePath()

  async ensureStateExists(workspacePath?: string | null) {
    await ensureStateFileExists(this.globalStatePath)
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    if (normalizedWorkspacePath) {
      const stateFile = await readStateFile(this.globalStatePath)
      await migrateLegacyWorkspaceStateIfNeeded(normalizedWorkspacePath, stateFile)
    }
  }

  async readAutoConnectMap(workspacePath?: string | null) {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    const stateFile = await readStateFile(this.globalStatePath)
    const globalState = getWorkspaceState(stateFile, GLOBAL_STATE_KEY)?.servers ?? {}

    if (!normalizedWorkspacePath) {
      return globalState
    }

    const workspaceKey = getWorkspaceStateKey(normalizedWorkspacePath)
    const workspaceState = getWorkspaceState(stateFile, workspaceKey)
    if (workspaceState) {
      return {
        ...globalState,
        ...workspaceState.servers,
      }
    }

    const legacyWorkspaceState = await readLegacyWorkspaceState(normalizedWorkspacePath)
    return {
      ...globalState,
      ...(legacyWorkspaceState?.servers ?? {}),
    }
  }

  async getAutoConnect(serverName: string, workspacePath?: string | null) {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    const stateFile = await readStateFile(this.globalStatePath)

    if (normalizedWorkspacePath) {
      const workspaceKey = getWorkspaceStateKey(normalizedWorkspacePath)
      const workspaceState = getWorkspaceState(stateFile, workspaceKey)
      if (workspaceState?.servers[serverName]) {
        return workspaceState.servers[serverName].autoConnect
      }

      const legacyWorkspaceState = await readLegacyWorkspaceState(normalizedWorkspacePath)
      if (legacyWorkspaceState?.servers[serverName]) {
        return legacyWorkspaceState.servers[serverName].autoConnect
      }
    }

    return stateFile.workspaces[GLOBAL_STATE_KEY]?.servers[serverName]?.autoConnect
  }

  async setAutoConnect(serverName: string, autoConnect: boolean, workspacePath?: string | null) {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    if (normalizedWorkspacePath) {
      await this.ensureStateExists(normalizedWorkspacePath)
    }

    const stateFile = await readStateFile(this.globalStatePath)

    if (normalizedWorkspacePath) {
      const workspaceKey = getWorkspaceStateKey(normalizedWorkspacePath)
      const workspaceState = getWorkspaceState(stateFile, workspaceKey) ?? { servers: {} }
      workspaceState.servers[serverName] = { autoConnect }
      setWorkspaceState(stateFile, workspaceKey, workspaceState)
      await writeStateFile(this.globalStatePath, stateFile)
      return
    }

    const globalState = getWorkspaceState(stateFile, GLOBAL_STATE_KEY) ?? { servers: {} }
    globalState.servers[serverName] = { autoConnect }
    setWorkspaceState(stateFile, GLOBAL_STATE_KEY, globalState)
    await writeStateFile(this.globalStatePath, stateFile)
  }

  async removeServer(serverName: string, workspacePath?: string | null) {
    const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
    if (normalizedWorkspacePath) {
      await this.ensureStateExists(normalizedWorkspacePath)
    }

    const stateFile = await readStateFile(this.globalStatePath)

    if (normalizedWorkspacePath) {
      const workspaceKey = getWorkspaceStateKey(normalizedWorkspacePath)
      removeServerFromWorkspaceState(stateFile, workspaceKey, serverName)
      await writeStateFile(this.globalStatePath, stateFile)
      return
    }

    removeServerFromWorkspaceState(stateFile, GLOBAL_STATE_KEY, serverName)
    await writeStateFile(this.globalStatePath, stateFile)
  }
}

let stateStoreInstance: McpStateStore | null = null

export function getMcpStateStore() {
  if (!stateStoreInstance) {
    stateStoreInstance = new McpStateStore()
  }

  return stateStoreInstance
}
