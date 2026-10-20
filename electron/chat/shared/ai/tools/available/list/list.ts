import { availableNamespaces, discoveryToolDescription, inNamespace, mcpNamespaceDescription, NATIVE_NAMESPACE_DESCRIPTIONS, type DiscoveryEntry } from '../discoveryCatalog'

export type AvailableListEntry = DiscoveryEntry

export function listAvailableApis(entries: readonly AvailableListEntry[], page: number, namespace = 'root') {
  const servers = availableNamespaces(entries)
  const matching = namespace === 'root'
    ? servers.map((name) => ({
      name,
      description: NATIVE_NAMESPACE_DESCRIPTIONS[name] ?? mcpNamespaceDescription(entries, name),
    }))
    : entries.filter((entry) => inNamespace(entry, namespace))
      .map((entry) => ({
        name: entry.name,
        description: discoveryToolDescription(entry.name, entry.namespace, entry.description),
      }))
  const sorted = [...new Map(matching.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => [entry.name, entry])).values()]
  const offset = (page - 1) * 10
  return {
    items: sorted.slice(offset, offset + 10),
    page,
    namespace,
    hasMore: offset + 10 < sorted.length,
  }
}

export function formatAvailableApiList(result: ReturnType<typeof listAvailableApis>): string {
  const names = result.items.map(({ name, description }) => `- \`${name}\` - ${description}`)
  return [
    `# Available ${result.namespace === 'root' ? 'tool namespaces' : `${result.namespace} tools`} (page ${result.page})`,
    '',
    ...(names.length ? names : ['No tools on this page.']),
    '',
    ...(result.namespace === 'root' ? ['Each listed namespace is a discovery category, not a callable tool. Use `tools.available.list({ namespace: "listed_namespace" })` to see exact callable names such as `tools.read`, then retrieve their contracts with `tools.available.get({ name: "tools.read" })`. Do not call `tools.native_files.list`.', ''] : []),
    result.hasMore
      ? `More entries available. Continue with \`tools.available.list({ namespace: ${JSON.stringify(result.namespace)}, page: ${result.page + 1} })\`.`
      : 'End of available tool list.',
  ].join('\n')
}
