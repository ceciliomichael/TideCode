export interface AvailableListEntry { name: string; namespace: string; description: string }

export function mcpServerNamespace(description: string): string | null {
  const authoritative = /; namespace "([^"]+)"\]/u.exec(description)?.[1]
  if (authoritative) return authoritative
  return /^\[[^\]]+ MCP server "([^"]+)"; original tool "/u.exec(description)?.[1] ?? null
}

export function listAvailableApis(entries: readonly AvailableListEntry[], page: number, namespace = 'native') {
  const servers = [...new Set(entries.filter((entry) => entry.namespace === 'mcp').map((entry) => mcpServerNamespace(entry.description)).filter((name): name is string => name !== null))]
  const names = namespace === 'mcp' ? servers : entries.filter((entry) => namespace === 'native' ? entry.namespace !== 'mcp' : entry.namespace === 'mcp' && mcpServerNamespace(entry.description)?.toLowerCase() === namespace.toLowerCase()).map((entry) => entry.name)
  const sorted = [...new Set(names)].sort()
  const offset = (page - 1) * 10
  return {
    items: sorted.slice(offset, offset + 10).map((name) => ({ name })),
    page,
    namespace,
    hasMore: offset + 10 < sorted.length,
  }
}

export function formatAvailableApiList(result: ReturnType<typeof listAvailableApis>): string {
  const names = result.items.map(({ name }) => `- \`${name}\``)
  return [
    `# Available ${result.namespace === 'mcp' ? 'MCP server namespaces' : `${result.namespace} tools`} (page ${result.page})`,
    '',
    ...(names.length ? names : ['No tools on this page.']),
    '',
    result.hasMore
      ? `More entries available. Continue with \`tools.available.list({ namespace: ${JSON.stringify(result.namespace)}, page: ${result.page + 1} })\`.`
      : 'End of available tool list.',
  ].join('\n')
}


