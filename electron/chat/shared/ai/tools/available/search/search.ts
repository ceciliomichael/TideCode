import { discoveryToolDescription, entryNamespace, inNamespace } from '../discoveryCatalog'

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

/** Discovery returns names and short descriptions. Full contracts remain behind available.get. */
export function searchAvailableApis(items: readonly AvailableApiMatch[], input: AvailableSearchOptions) {
  const query = input.query?.trim().toLowerCase() ?? ''
  const namespace = input.namespace?.trim().toLowerCase()
  const terms = query.split(/\s+/u).filter(Boolean)
  const offset = Math.max(0, input.offset ?? 0)
  // MCP descriptions carry their authoritative server identity from toolAdapter.
  // An exact server-name query expands to every registered tool from that server.
  const serverNames = new Set(items.filter((item) => item.namespace === 'mcp')
    .map((item) => entryNamespace({ name: item.path, namespace: item.namespace, description: item.description }))
    .filter((name): name is string => Boolean(name)))
  const selectedServer = serverNames.has(query) ? query : null
  const limit = Math.max(1, Math.min(10, input.limit ?? 10))
  const matching = items.map((item) => {
    const server = entryNamespace({ name: item.path, namespace: item.namespace, description: item.description })
    const name = item.path.toLowerCase()
    const description = discoveryToolDescription(item.path, item.namespace, item.description).toLowerCase()
    const nameTokens = name.split(/[^a-z0-9]+/u).filter(Boolean)
    const score = terms.reduce((sum, term) => sum
      + (name === term ? 120 : nameTokens.includes(term) ? 65 : name.includes(term) ? 30 : 0)
      + (server === term ? 20 : server.includes(term) ? 5 : 0)
      + (description.includes(term) ? 10 : 0), 0)
    const haystack = `${name} ${description} ${server}`
    return { item, score, haystack, matchesServer: selectedServer !== null && server === selectedServer }
  }).filter(({ item, score, haystack, matchesServer }) =>
    (!namespace || inNamespace({ name: item.path, namespace: item.namespace, description: item.description }, namespace))
    && (matchesServer || terms.length === 0 || terms.every((term) => haystack.includes(term)) && score > 0))
    .sort((left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path))
  const page = matching.slice(offset, offset + limit).map(({ item }) => ({
    name: item.path,
    description: discoveryToolDescription(item.path, item.namespace, item.description),
  }))
  const remaining = Math.max(0, matching.length - offset - page.length)
  return { items: page, remaining, next: remaining > 0 ? { offset: offset + page.length } : null }
}

export function formatAvailableApiSearch(result: ReturnType<typeof searchAvailableApis>, input: AvailableSearchOptions): string {
  const names = result.items.map(({ name, description }) => `- \`${name}\` - ${description}`)
  const heading = input.query?.trim() ? `# Tool search: ${input.query.trim()}` : '# Tool search results'
  const continuation = result.next
    ? `More results (${result.remaining} remaining). Continue with \`tools.available.search(${JSON.stringify({ ...input, offset: result.next.offset })})\`.`
    : 'End of search results.'
  return [heading, '', `Namespace: ${input.namespace || 'all'}`, `Showing ${result.items.length} match(es)${result.remaining ? ` (${result.remaining} more)` : ''}`, '', ...(names.length ? names : ['No matching tools found.']), '', continuation].join('\n')
}
