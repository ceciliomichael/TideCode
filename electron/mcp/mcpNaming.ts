import { createHash, randomUUID } from 'node:crypto'
import type { McpServerConfig } from '../../src/types/mcp'

export const MCP_SERVER_NAMESPACE_MAX_LENGTH = 16
export const MCP_TOOL_SEGMENT_MAX_LENGTH = 32
export const MCP_TOOL_HASH_LENGTH = 6

const MCP_SERVER_ID_PATTERN = /^mcp-[a-z0-9][a-z0-9_-]{0,127}$/u

function normalizeFallback(fallback: string) {
  const normalized = fallback
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')

  return normalized || 'item'
}

export function normalizeMcpIdentitySegment(value: string, fallback: string, maxLength: number) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '')

  const fallbackSegment = normalizeFallback(fallback)
  const truncated = (normalized || fallbackSegment).slice(0, maxLength).replace(/_+$/u, '')
  return truncated || fallbackSegment.slice(0, maxLength) || 'item'
}

export function createStableMcpHash(value: string, length = MCP_TOOL_HASH_LENGTH) {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

export function appendMcpHashSuffix(base: string, identity: string, maxLength: number) {
  const suffix = createStableMcpHash(identity)
  const availableBaseLength = Math.max(1, maxLength - suffix.length - 1)
  const truncatedBase = base.slice(0, availableBaseLength).replace(/_+$/u, '') || 'item'
  return `${truncatedBase}_${suffix}`
}

export function isValidMcpServerId(value: string) {
  return MCP_SERVER_ID_PATTERN.test(value)
}

export function createMcpServerId(serverName: string) {
  const serverSegment = normalizeMcpIdentitySegment(serverName, 'server', 24)
  const entropy = randomUUID().replace(/-/gu, '').slice(0, 8)
  return `mcp-${serverSegment}-${entropy}`
}

export function createLegacyMcpServerId(serverName: string, owner: string) {
  const serverSegment = normalizeMcpIdentitySegment(serverName, 'server', 24)
  const stableSuffix = createStableMcpHash(`${owner}:${serverName}`, 8)
  return `mcp-${serverSegment}-${stableSuffix}`
}

export function createMcpServerToolNamespace(serverName: string) {
  return normalizeMcpIdentitySegment(serverName, 'server', MCP_SERVER_NAMESPACE_MAX_LENGTH)
}

export function createUniqueMcpServerToolNamespace(
  serverName: string,
  identity: string,
  usedNamespaces: ReadonlySet<string>,
) {
  const base = createMcpServerToolNamespace(serverName)
  let candidate = base
  let attempt = 0

  while (usedNamespaces.has(candidate)) {
    candidate = appendMcpHashSuffix(base, `${identity}:${attempt}`, MCP_SERVER_NAMESPACE_MAX_LENGTH)
    attempt += 1
  }

  return candidate
}

export function assignMcpToolNamespaces(configs: readonly McpServerConfig[]) {
  const usedNamespaces = new Set<string>()

  return configs.map((config) => {
    const base = normalizeMcpIdentitySegment(
      config.toolNamespace || config.name,
      'server',
      MCP_SERVER_NAMESPACE_MAX_LENGTH,
    )
    let namespace = base
    let attempt = 0

    while (usedNamespaces.has(namespace)) {
      namespace = appendMcpHashSuffix(
        base,
        `${config.owner}:${config.id}:${config.name}:${attempt}`,
        MCP_SERVER_NAMESPACE_MAX_LENGTH,
      )
      attempt += 1
    }

    usedNamespaces.add(namespace)
    return namespace === config.toolNamespace ? config : { ...config, toolNamespace: namespace }
  })
}

export function createMcpToolSegment(toolName: string) {
  return normalizeMcpIdentitySegment(toolName, 'tool', MCP_TOOL_SEGMENT_MAX_LENGTH)
}

export function createMcpCatalogToolName(serverNamespace: string, toolSegment: string) {
  const normalizedServerNamespace = normalizeMcpIdentitySegment(
    serverNamespace,
    'server',
    MCP_SERVER_NAMESPACE_MAX_LENGTH,
  )
  const normalizedToolSegment = normalizeMcpIdentitySegment(toolSegment, 'tool', MCP_TOOL_SEGMENT_MAX_LENGTH)
  return `mcp_${normalizedServerNamespace}_${normalizedToolSegment}`
}
