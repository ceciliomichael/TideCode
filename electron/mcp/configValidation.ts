import { z } from 'zod'
import type { McpAddServerInput } from '../../src/types/mcp'
import type { McpTransportType } from '../../src/types/mcp'
import { isValidMcpServerId } from './mcpNaming'

export const MCP_VALIDATION_ERRORS = {
  MIXED_FIELDS_ERROR:
    "Cannot mix 'stdio' and URL-based fields. For 'stdio' use 'command', 'args', and 'env'. For URL-based servers use 'url' and 'headers'.",
  MULTIPLE_SERVERS_ERROR:
    'Paste a single MCP server entry or provide an explicit server name for the config you want to add.',
  MISSING_FIELDS_ERROR:
    "Server configuration must include either 'command' (for stdio) or 'url' (for streamable-http).",
  SERVER_NAME_REQUIRED: 'A server name is required.',
  STREAMABLE_HTTP_FIELDS_ERROR:
    "For URL-based servers, provide a 'url' field and optional 'headers'.",
  STDIO_FIELDS_ERROR:
    "For 'stdio' servers, provide a 'command' field and optional 'args' and 'env'.",
  TYPE_ERROR: "Server type must be 'stdio' or 'streamable-http'.",
  URL_TYPE_REQUIRED: "Configurations with 'url' must explicitly specify 'type' as 'streamable-http'.",
} as const

const MCP_SETTINGS_SCHEMA = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
})

const MCP_ADD_SERVER_INPUT_SCHEMA = z.object({
  args: z.array(z.string()).optional(),
  command: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  saveScope: z.enum(['global']).optional(),
  serverName: z.string(),
  type: z.enum(['stdio', 'streamable-http']),
  url: z.string().optional(),
})

const ALLOWED_SERVER_TYPES: readonly McpTransportType[] = ['stdio', 'streamable-http']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const sanitized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)

  return sanitized.length > 0 ? sanitized : undefined
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const sanitized: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'string') {
      continue
    }

    const normalizedKey = key.trim()
    const normalizedValue = candidate.trim()
    if (normalizedKey.length === 0 || normalizedValue.length === 0) {
      continue
    }

    sanitized[normalizedKey] = normalizedValue
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function sanitizeInternalIdentifier(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maxLength || !/^[a-zA-Z0-9_-]+$/u.test(normalized)) {
    return undefined
  }

  return normalized
}

export interface RawMcpServerConfig extends Record<string, unknown> {
  args?: string[]
  command?: string
  disabled?: boolean
  disabledTools?: string[]
  alwaysAllow?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  tidecodeId?: string
  tidecodeToolNamespace?: string
  type?: McpTransportType
  url?: string
}

export interface McpSettingsFile {
  mcpServers: Record<string, RawMcpServerConfig>
}

export function validateServerConfig(config: unknown, serverName?: string): RawMcpServerConfig {
  if (!isPlainObject(config)) {
    throw new Error(
      serverName
        ? `Invalid configuration for server "${serverName}": Configuration must be an object`
        : 'Invalid server configuration: Configuration must be an object',
    )
  }

  const rawConfig = config as Record<string, unknown>
  const hasStdioFields = rawConfig.command !== undefined
  const hasUrlFields = rawConfig.url !== undefined

  if (hasStdioFields && hasUrlFields) {
    throw new Error(MCP_VALIDATION_ERRORS.MIXED_FIELDS_ERROR)
  }

  if (hasUrlFields && !rawConfig.type) {
    throw new Error(MCP_VALIDATION_ERRORS.URL_TYPE_REQUIRED)
  }

  if (rawConfig.type && !ALLOWED_SERVER_TYPES.includes(rawConfig.type as McpTransportType)) {
    throw new Error(MCP_VALIDATION_ERRORS.TYPE_ERROR)
  }

  if (rawConfig.type === 'stdio' && !hasStdioFields) {
    throw new Error(MCP_VALIDATION_ERRORS.STDIO_FIELDS_ERROR)
  }

  if (rawConfig.type === 'streamable-http' && !hasUrlFields) {
    throw new Error(MCP_VALIDATION_ERRORS.STREAMABLE_HTTP_FIELDS_ERROR)
  }

  if (!hasStdioFields && !hasUrlFields) {
    throw new Error(MCP_VALIDATION_ERRORS.MISSING_FIELDS_ERROR)
  }

  const sanitizedTideCodeToolNamespace = sanitizeInternalIdentifier(rawConfig.tidecodeToolNamespace, 64)

  const nextConfig: RawMcpServerConfig = {
    ...(isPlainObject(rawConfig.env) ? { env: sanitizeStringRecord(rawConfig.env) } : {}),
    ...(isPlainObject(rawConfig.headers) ? { headers: sanitizeStringRecord(rawConfig.headers) } : {}),
    ...(sanitizeStringArray(rawConfig.args) ? { args: sanitizeStringArray(rawConfig.args) } : {}),
    ...(sanitizeStringArray(rawConfig.alwaysAllow) ? { alwaysAllow: sanitizeStringArray(rawConfig.alwaysAllow) } : {}),
    ...(sanitizeStringArray(rawConfig.disabledTools)
      ? { disabledTools: sanitizeStringArray(rawConfig.disabledTools) }
      : {}),
    ...(typeof rawConfig.command === 'string' && rawConfig.command.trim().length > 0
      ? { command: rawConfig.command.trim() }
      : {}),
    ...(typeof rawConfig.disabled === 'boolean' ? { disabled: rawConfig.disabled } : {}),
    ...(typeof rawConfig.tidecodeId === 'string' && isValidMcpServerId(rawConfig.tidecodeId.trim())
      ? { tidecodeId: rawConfig.tidecodeId.trim() }
      : {}),
    ...(sanitizedTideCodeToolNamespace ? { tidecodeToolNamespace: sanitizedTideCodeToolNamespace } : {}),
    ...(typeof rawConfig.url === 'string' && rawConfig.url.trim().length > 0 ? { url: rawConfig.url.trim() } : {}),
    ...(typeof rawConfig.type === 'string'
      ? { type: rawConfig.type as McpTransportType }
      : hasStdioFields
        ? { type: 'stdio' as const }
        : {}),
  }

  return nextConfig
}

export function parseMcpSettings(content: string): { data?: McpSettingsFile; error?: string; success: boolean } {
  try {
    const parsed = JSON.parse(content) as unknown
    const result = MCP_SETTINGS_SCHEMA.safeParse(parsed)
    if (!result.success) {
      return {
        error: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
        success: false,
      }
    }

    const validatedServers: Record<string, RawMcpServerConfig> = {}
    for (const [serverName, config] of Object.entries(result.data.mcpServers)) {
      validatedServers[serverName] = validateServerConfig(config, serverName)
    }

    return {
      data: {
        mcpServers: validatedServers,
      },
      success: true,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid JSON syntax',
      success: false,
    }
  }
}

function normalizeOptionalTrimmedString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeMcpAddServerInput(data: z.infer<typeof MCP_ADD_SERVER_INPUT_SCHEMA>): McpAddServerInput {
  const saveScope = data.saveScope ?? 'global'
  const serverName = data.serverName.trim()
  const type = data.type

  function normalizeStringRecord(
    value: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!value) {
      return undefined
    }

    const normalizedEntries = Object.entries(value)
      .map(([key, entryValue]) => [key.trim(), entryValue.trim()] as const)
      .filter(([key, entryValue]) => key.length > 0 && entryValue.length > 0)

    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined
  }

  if (type === 'stdio') {
    return {
      ...(typeof data.args !== 'undefined' ? { args: data.args.filter((item) => item.trim().length > 0) } : {}),
      ...(normalizeOptionalTrimmedString(data.command) ? { command: normalizeOptionalTrimmedString(data.command) } : {}),
      ...(normalizeStringRecord(data.env) ? { env: normalizeStringRecord(data.env) } : {}),
      saveScope,
      serverName,
      type,
    }
  }

  return {
    ...(normalizeStringRecord(data.headers) ? { headers: normalizeStringRecord(data.headers) } : {}),
    ...(normalizeOptionalTrimmedString(data.url) ? { url: normalizeOptionalTrimmedString(data.url) } : {}),
    saveScope,
    serverName,
    type,
  }
}

function validateAddServerInputShape(input: McpAddServerInput) {
  if (input.serverName.trim().length === 0) {
    throw new Error(MCP_VALIDATION_ERRORS.SERVER_NAME_REQUIRED)
  }

  if (input.type === 'stdio') {
    if (!normalizeOptionalTrimmedString(input.command)) {
      throw new Error(MCP_VALIDATION_ERRORS.STDIO_FIELDS_ERROR)
    }
    return
  }

  if (!normalizeOptionalTrimmedString(input.url)) {
    throw new Error(MCP_VALIDATION_ERRORS.STREAMABLE_HTTP_FIELDS_ERROR)
  }
}

export function parseMcpAddServerInput(
  input: unknown,
): { data?: McpAddServerInput; error?: string; success: boolean } {
  try {
    const result = MCP_ADD_SERVER_INPUT_SCHEMA.safeParse(input)
    if (!result.success) {
      return {
        error: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
        success: false,
      }
    }

    const normalizedInput = normalizeMcpAddServerInput(result.data)
    validateAddServerInputShape(normalizedInput)

    return {
      data: normalizedInput,
      success: true,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid MCP server input',
      success: false,
    }
  }
}
