import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { McpAddServerInput, McpConfigOwner, McpConfigSource, McpServerConfig } from '../../src/types/mcp'
import { type McpSettingsFile, parseMcpAddServerInput, parseMcpSettings, type RawMcpServerConfig } from './configValidation'

const CONFIG_ROOT_SEGMENTS = ['.echosphere', 'mcp'] as const
const GLOBAL_CONFIG_FILENAME = 'mcp.json'
const EXTERNAL_PROVIDER_CONFIGS = [
  { owner: 'codex', directoryName: '.codex' },
  { owner: 'agents', directoryName: '.agents' },
  { owner: 'claude', directoryName: '.claude' },
] as const

interface McpConfigCandidate {
  owner: McpConfigOwner
  path: string
  scope: McpConfigSource
}

function getConfigRootPath() {
  return path.join(app.getPath('home'), ...CONFIG_ROOT_SEGMENTS)
}

function getGlobalConfigPath() {
  return path.join(getConfigRootPath(), GLOBAL_CONFIG_FILENAME)
}

function getExternalConfigPath(basePath: string, directoryName: string) {
  return path.join(basePath, directoryName, GLOBAL_CONFIG_FILENAME)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function generateServerId(name: string) {
  return `mcp-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
}

function toRecordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const result: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'string') {
      continue
    }

    const normalizedKey = key.trim()
    const normalizedValue = candidate.trim()
    if (normalizedKey.length === 0 || normalizedValue.length === 0) {
      continue
    }

    result[normalizedKey] = normalizedValue
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const result = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)

  return result.length > 0 ? result : undefined
}

function hasStringEntries(value: Record<string, string> | undefined) {
  return typeof value !== 'undefined' && Object.keys(value).length > 0
}

export function buildMcpServerConfig(
  serverName: string,
  rawConfig: RawMcpServerConfig,
  source: McpConfigSource,
  owner: McpConfigOwner,
): McpServerConfig {
  return {
    autoConnect: false,
    owner,
    ...(typeof rawConfig.args !== 'undefined' ? { args: rawConfig.args } : {}),
    ...(typeof rawConfig.command === 'string' ? { command: rawConfig.command } : {}),
    ...(typeof rawConfig.description === 'string' && rawConfig.description.trim().length > 0
      ? { description: rawConfig.description.trim() }
      : {}),
    enabled: rawConfig.disabled !== true,
    ...(typeof rawConfig.env !== 'undefined' ? { env: toRecordOfStrings(rawConfig.env) } : {}),
    ...(typeof rawConfig.headers !== 'undefined' ? { headers: toRecordOfStrings(rawConfig.headers) } : {}),
    id: generateServerId(serverName),
    isReadOnly: owner !== 'echosphere',
    name: serverName,
    source,
    ...(typeof rawConfig.alwaysAllow !== 'undefined' || typeof rawConfig.disabledTools !== 'undefined'
      ? {
          toolConfiguration: {
            enabled: true,
            ...(toStringArray(rawConfig.alwaysAllow) ? { allowedTools: toStringArray(rawConfig.alwaysAllow) } : {}),
            ...(toStringArray(rawConfig.disabledTools)
              ? { disabledTools: toStringArray(rawConfig.disabledTools) }
              : {}),
          },
        }
      : {}),
    type: rawConfig.type ?? 'stdio',
    ...(typeof rawConfig.url === 'string' ? { url: rawConfig.url } : {}),
  }
}

function configToRaw(config: McpServerConfig): RawMcpServerConfig {
  const rawConfig: RawMcpServerConfig = {
    ...(config.args ? { args: [...config.args] } : {}),
    ...(config.command ? { command: config.command } : {}),
    ...(config.description ? { description: config.description } : {}),
    ...(config.enabled ? {} : { disabled: true }),
    ...(config.env ? { env: { ...config.env } } : {}),
    ...(config.headers ? { headers: { ...config.headers } } : {}),
    ...(config.toolConfiguration?.allowedTools?.length ? { alwaysAllow: [...config.toolConfiguration.allowedTools] } : {}),
    ...(config.toolConfiguration?.disabledTools?.length
      ? { disabledTools: [...config.toolConfiguration.disabledTools] }
      : {}),
    type: config.type,
    ...(config.url ? { url: config.url } : {}),
  }

  return rawConfig
}

async function ensureDirectoryExists(targetPath: string) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
}

async function readConfigFile(configPath: string): Promise<McpSettingsFile | null> {
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    const parsed = parseMcpSettings(raw)
    if (!parsed.success || !parsed.data) {
      throw new Error(parsed.error ?? 'Invalid MCP config')
    }

    return parsed.data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeConfigFile(configPath: string, data: McpSettingsFile) {
  await ensureDirectoryExists(configPath)
  await fs.writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function ensureConfigFileExists(configPath: string) {
  try {
    await fs.access(configPath)
  } catch {
    await writeConfigFile(configPath, { mcpServers: {} })
  }
}

export async function loadMergedMcpConfigs(): Promise<McpServerConfig[]> {
  const configsByName = new Map<string, McpServerConfig>()
  const candidates: McpConfigCandidate[] = []

  candidates.push({
    owner: 'echosphere',
    path: getGlobalConfigPath(),
    scope: 'global',
  })

  for (const provider of EXTERNAL_PROVIDER_CONFIGS) {
    candidates.push({
      owner: provider.owner,
      path: getExternalConfigPath(app.getPath('home'), provider.directoryName),
      scope: 'global',
    })
  }

  for (const candidate of candidates) {
    const configFile = await readConfigFile(candidate.path)
    if (!configFile) {
      continue
    }

    for (const [serverName, rawConfig] of Object.entries(configFile.mcpServers)) {
      if (configsByName.has(serverName)) {
        continue
      }

      configsByName.set(
        serverName,
        buildMcpServerConfig(
          serverName,
          rawConfig,
          candidate.scope,
          candidate.owner,
        ),
      )
    }
  }

  return Array.from(configsByName.values()).sort((left, right) => left.name.localeCompare(right.name))
}

export async function ensureMcpConfigExists() {
  await ensureConfigFileExists(getGlobalConfigPath())
}

export function getPreferredMcpConfigPath(workspacePath?: string | null) {
  void workspacePath
  return getGlobalConfigPath()
}

export function getMcpGlobalConfigPath() {
  return getGlobalConfigPath()
}

export async function appendMcpServerConfig(
  input: McpAddServerInput,
) {
  const parsed = parseMcpAddServerInput(input)
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error ?? 'Unable to parse the provided MCP server input.')
  }

  const { serverName, type } = parsed.data
  void parsed.data.saveScope
  const targetPath = getGlobalConfigPath()
  const existing = (await readConfigFile(targetPath)) ?? { mcpServers: {} }
  const rawConfig: RawMcpServerConfig =
    type === 'stdio'
      ? {
          ...(parsed.data.args && parsed.data.args.length > 0 ? { args: parsed.data.args } : {}),
          ...(parsed.data.command ? { command: parsed.data.command } : {}),
          ...(hasStringEntries(parsed.data.env) ? { env: parsed.data.env } : {}),
          type,
        }
      : {
          ...(hasStringEntries(parsed.data.headers) ? { headers: parsed.data.headers } : {}),
          ...(parsed.data.url ? { url: parsed.data.url } : {}),
          type,
        }
  const nextConfig: McpSettingsFile = {
    mcpServers: {
      ...existing.mcpServers,
      [serverName]: rawConfig,
    },
  }

  await writeConfigFile(targetPath, nextConfig)
}

export async function saveMcpConfig(config: McpServerConfig) {
  if (config.isReadOnly || config.owner !== 'echosphere') {
    throw new Error(`MCP server "${config.name}" is managed by ${config.owner} and cannot be edited from TideCode.`)
  }
  void config.source
  const targetPath = getGlobalConfigPath()
  const existing = (await readConfigFile(targetPath)) ?? { mcpServers: {} }
  const nextConfig: McpSettingsFile = {
    mcpServers: {
      ...existing.mcpServers,
      [config.name]: configToRaw(config),
    },
  }

  await writeConfigFile(targetPath, nextConfig)
}

export async function replaceMcpServerConfig(
  previousServerName: string,
  config: McpServerConfig,
) {
  if (config.isReadOnly || config.owner !== 'echosphere') {
    throw new Error(`MCP server "${config.name}" is managed by ${config.owner} and cannot be edited from TideCode.`)
  }
  void config.source
  const targetPath = getGlobalConfigPath()
  const existing = (await readConfigFile(targetPath)) ?? { mcpServers: {} }
  const nextServers: Record<string, RawMcpServerConfig> = {}

  for (const [serverName, rawConfig] of Object.entries(existing.mcpServers)) {
    if (serverName === previousServerName) {
      continue
    }

    nextServers[serverName] = rawConfig
  }

  nextServers[config.name] = configToRaw(config)

  await writeConfigFile(targetPath, { mcpServers: nextServers })
}

export async function deleteMcpConfig(serverId: string, workspacePath?: string | null) {
  void workspacePath
  const configPath = getGlobalConfigPath()
  const existing = await readConfigFile(configPath)
  if (!existing) {
    return
  }

  const nextServers: Record<string, RawMcpServerConfig> = {}
  let hasChanges = false

  for (const [serverName, rawConfig] of Object.entries(existing.mcpServers)) {
    if (generateServerId(serverName) === serverId) {
      hasChanges = true
      continue
    }

    nextServers[serverName] = rawConfig
  }

  if (hasChanges) {
    await writeConfigFile(configPath, { mcpServers: nextServers })
  }
}

export async function loadMcpConfigPath(workspacePath?: string | null) {
  void workspacePath
  return getGlobalConfigPath()
}
