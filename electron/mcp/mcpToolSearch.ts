import type { McpToolCatalogEntry } from './mcpToolCatalog'

export const DEFAULT_MCP_TOOL_SEARCH_LIMIT = 5
export const MAX_MCP_TOOL_SEARCH_LIMIT = 20
const MAX_MCP_TOOL_QUERY_LENGTH = 500

export interface McpToolSearchInput {
  include_schema?: boolean
  limit?: number
  query: string
}

export interface NormalizedMcpToolSearchInput {
  include_schema: boolean
  limit: number
  query: string
}

export interface McpToolSearchMatch {
  description?: string
  input_schema?: Record<string, unknown>
  name: string
  server: string
  title?: string
  tool_id: string
}

export interface McpToolSearchResult {
  include_schema: boolean
  limit: number
  query: string
  tools: McpToolSearchMatch[]
}

interface SearchField {
  exactWeight: number
  tokenWeight: number
  value: string
}

interface ScoredCatalogEntry {
  entry: McpToolCatalogEntry
  score: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function tokenize(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/u)
    .filter((token) => token.length > 0)
}

function getSearchFields(entry: McpToolCatalogEntry): SearchField[] {
  const description = entry.tool.description?.trim() ?? ''
  const title = entry.tool.title?.trim() ?? ''

  return [
    {
      exactWeight: 1_000,
      tokenWeight: 240,
      value: entry.catalogId,
    },
    {
      exactWeight: 950,
      tokenWeight: 300,
      value: entry.tool.name,
    },
    {
      exactWeight: 760,
      tokenWeight: 180,
      value: title,
    },
    {
      exactWeight: 420,
      tokenWeight: 80,
      value: `${entry.config.name} ${entry.tool.name}`,
    },
    {
      exactWeight: 180,
      tokenWeight: 45,
      value: description,
    },
  ].filter((field) => field.value.length > 0)
}

function scoreCatalogEntry(entry: McpToolCatalogEntry, query: string, queryTokens: readonly string[]) {
  const normalizedQuery = normalizeSearchText(query)
  const fields = getSearchFields(entry)
  let score = 0
  let matchedTokenCount = 0

  for (const field of fields) {
    const normalizedField = normalizeSearchText(field.value)
    if (normalizedField === normalizedQuery) {
      score += field.exactWeight
    } else if (normalizedQuery.length > 0 && normalizedField.includes(normalizedQuery)) {
      score += field.exactWeight * 0.55
    }

    const fieldTokens = new Set(tokenize(field.value))
    for (const queryToken of queryTokens) {
      if (fieldTokens.has(queryToken)) {
        score += field.tokenWeight
        continue
      }

      if (normalizeSearchText(field.value).includes(queryToken)) {
        score += field.tokenWeight * 0.35
      }
    }
  }

  for (const queryToken of queryTokens) {
    const tokenMatches = fields.some((field) => normalizeSearchText(field.value).includes(queryToken))
    if (tokenMatches) {
      matchedTokenCount += 1
    }
  }

  if (matchedTokenCount === 0) {
    return null
  }

  // Reward complete multi-token matches and keep partial matches available for
  // natural-language MCP descriptions that omit stop words or synonyms.
  const coverage = matchedTokenCount / queryTokens.length
  score += coverage * 500
  if (matchedTokenCount === queryTokens.length) {
    score += 250
  }

  return score
}

function toSearchMatch(entry: McpToolCatalogEntry, includeSchema: boolean): McpToolSearchMatch {
  const description = entry.tool.description?.trim() ?? ''
  const title = entry.tool.title?.trim() ?? ''

  return {
    ...(description.length > 0 ? { description } : {}),
    ...(includeSchema ? { input_schema: entry.tool.inputSchema } : {}),
    name: entry.tool.name,
    server: entry.config.name,
    ...(title.length > 0 ? { title } : {}),
    tool_id: entry.catalogId,
  }
}

export function normalizeMcpToolSearchInput(input: unknown): NormalizedMcpToolSearchInput {
  if (!isRecord(input)) {
    throw new Error('mcp_tool_search requires an object argument.')
  }

  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (query.length === 0) {
    throw new Error('mcp_tool_search requires a non-empty "query".')
  }
  if (query.length > MAX_MCP_TOOL_QUERY_LENGTH) {
    throw new Error(`mcp_tool_search query must be at most ${MAX_MCP_TOOL_QUERY_LENGTH} characters.`)
  }

  const includeSchema = input.include_schema === undefined ? false : input.include_schema
  if (typeof includeSchema !== 'boolean') {
    throw new Error('mcp_tool_search "include_schema" must be a boolean when provided.')
  }

  const limit = input.limit === undefined ? DEFAULT_MCP_TOOL_SEARCH_LIMIT : input.limit
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_MCP_TOOL_SEARCH_LIMIT) {
    throw new Error(
      `mcp_tool_search "limit" must be an integer from 1 to ${MAX_MCP_TOOL_SEARCH_LIMIT}.`,
    )
  }

  return {
    include_schema: includeSchema,
    limit,
    query,
  }
}

export function searchMcpToolCatalog(
  entries: readonly McpToolCatalogEntry[],
  rawInput: unknown,
): McpToolSearchResult {
  const input = normalizeMcpToolSearchInput(rawInput)
  const queryTokens = tokenize(input.query)
  if (queryTokens.length === 0) {
    throw new Error('mcp_tool_search query must contain letters or numbers.')
  }
  const rankedEntries: ScoredCatalogEntry[] = []

  for (const entry of entries) {
    const score = scoreCatalogEntry(entry, input.query, queryTokens)
    if (score === null) {
      continue
    }

    rankedEntries.push({ entry, score })
  }

  rankedEntries.sort((left, right) => right.score - left.score || left.entry.catalogId.localeCompare(right.entry.catalogId))

  return {
    include_schema: input.include_schema,
    limit: input.limit,
    query: input.query,
    tools: rankedEntries.slice(0, input.limit).map(({ entry }) => toSearchMatch(entry, input.include_schema)),
  }
}

export function isMcpToolSearchMatch(value: unknown): value is McpToolSearchMatch {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.name === 'string' &&
    typeof value.server === 'string' &&
    typeof value.tool_id === 'string' &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.input_schema === undefined || isRecord(value.input_schema)) &&
    (value.title === undefined || typeof value.title === 'string')
  )
}
