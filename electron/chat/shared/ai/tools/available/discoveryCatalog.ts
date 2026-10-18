export interface DiscoveryEntry {
  name: string
  namespace: string
  description: string
}

const NATIVE_SUMMARIES: Record<string, string> = {
  'tools.read': 'Read file or image contents.',
  'tools.list': 'Explore folders and discover paths.',
  'tools.glob': 'Find paths matching a pattern.',
  'tools.grep': 'Search text inside files.',
  'tools.edit': 'Preferred for exact text replacements across files.',
  'tools.patch': 'Apply complex contextual or multi-file patches.',
  'tools.write': 'Create or replace an entire file.',
  'tools.plan.create': 'Create a plan before implementation.',
  'tools.terminal.execute': 'Start a terminal command.',
  'tools.terminal.read': 'Read output from a terminal session.',
  'tools.terminal.interact': 'Send input to a terminal session.',
  'tools.terminal.terminate': 'Stop a terminal session.',
  'tools.skill.list': 'List available skills.',
  'tools.skill.search': 'Find relevant skills.',
  'tools.skill.load': 'Load skill instructions.',
}

export function mcpServerNamespace(description: string): string | null {
  const authoritative = /; namespace "([^"]+)"\]/u.exec(description)?.[1]
  if (authoritative) return authoritative
  return /^\[[^\]]+ MCP server "([^"]+)"; original tool "/u.exec(description)?.[1] ?? null
}

export function entryNamespace(entry: DiscoveryEntry): string {
  if (entry.namespace !== 'mcp') return 'native'
  return mcpServerNamespace(entry.description)?.toLowerCase() ?? ''
}

export function availableNamespaces(entries: readonly DiscoveryEntry[]) {
  return [...new Set(entries.map(entryNamespace).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function inNamespace(entry: DiscoveryEntry, namespace: string): boolean {
  return entryNamespace(entry) === namespace.toLowerCase()
}

export function compactToolDescription(description: string) {
  const clean = description.replace(/^\[[^\n]* MCP server "[^\n]*?"(?:;[^\n\]]*)?\]\s*/u, '')
    .replace(/[#`]/gu, ' ')
    .replace(/\s+/gu, ' ').trim()
  if (!clean || clean === 'MCP tool') return 'MCP tool.'
  return clean.length > 160 ? clean.slice(0, 157).trimEnd() + '...' : clean
}

export function discoveryToolDescription(name: string, namespace: string, description: string) {
  return namespace === 'mcp'
    ? compactToolDescription(description)
    : NATIVE_SUMMARIES[name] ?? compactToolDescription(description)
}
