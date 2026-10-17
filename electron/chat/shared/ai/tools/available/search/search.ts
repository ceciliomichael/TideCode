import { mcpServerNamespace } from '../list/list'

export interface AvailableApiMatch {
  path: string
  description: string
  namespace: string
  signature: string
}

export interface AvailableSearchOptions {
  query?: string
  namespace?: string
  limit?: number
  offset?: number
}

/** Discovery returns names only. The full contract is intentionally reserved for available.get. */
export function searchAvailableApis(items: readonly AvailableApiMatch[], input: AvailableSearchOptions) {
  const query = input.query?.trim().toLowerCase() ?? ''
  const namespace = input.namespace?.trim().toLowerCase()
  const terms = query.split(/\s+/u).filter(Boolean)
  const offset = Math.max(0, input.offset ?? 0)
  // MCP descriptions carry their authoritative server identity from toolAdapter.
  // An exact server-name query expands to every registered tool from that server.
  const serverNames = new Set(items.filter((item) => item.namespace === 'mcp')
    .map((item) => mcpServerNamespace(item.description)?.toLowerCase())
    .filter((name): name is string => Boolean(name)))
  const selectedServer = serverNames.has(query) ? query : null
  const limit = Math.max(1, Math.min(50, input.limit ?? 10))
  const matching = items.map((item) => {
    const haystack = `${item.path} ${item.description} ${item.namespace}`.toLowerCase()
    const score = terms.reduce((sum, term) => sum
      + (item.path.toLowerCase().includes(term) ? 50 : 0)
      + (item.description.toLowerCase().includes(term) ? 10 : 0)
      + (item.namespace.toLowerCase().includes(term) ? 15 : 0), 0)
    const server = item.namespace === 'mcp' ? mcpServerNamespace(item.description)?.toLowerCase() : undefined
    return { item, score, haystack, matchesServer: selectedServer !== null && server === selectedServer }
  }).filter(({ item, score, haystack, matchesServer }) =>
    (!namespace || (namespace === 'native' ? item.namespace !== 'mcp' : namespace === 'mcp' ? item.namespace === 'mcp' : item.namespace === 'mcp' && serverNames.has(namespace) && mcpServerNamespace(item.description)?.toLowerCase() === namespace))
    && (matchesServer || terms.length === 0 || terms.every((term) => haystack.includes(term)) && score > 0))
    .sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path))
  const page = matching.slice(offset, offset + limit).map(({ item }) => ({ name: item.path }))
  const remaining = Math.max(0, matching.length - offset - page.length)
  return { items: page, remaining, next: remaining > 0 ? { offset: offset + page.length } : null }
}

export function formatAvailableApiSearch(result: ReturnType<typeof searchAvailableApis>, input: AvailableSearchOptions): string {
  const names = result.items.map(({ name }) => `- \`${name}\``)
  const heading = input.query?.trim() ? `# Tool search: ${input.query.trim()}` : '# Tool search results'
  const continuation = result.next
    ? `More results (${result.remaining} remaining). Continue with \`tools.available.search(${JSON.stringify({ ...input, offset: result.next.offset })})\`.`
    : 'End of search results.'
  return [heading, '', `Namespace: ${input.namespace || 'all'}`, `Showing ${result.items.length} match(es)${result.remaining ? ` (${result.remaining} more)` : ''}`, '', ...(names.length ? names : ['No matching tools found.']), '', continuation].join('\n')
}
