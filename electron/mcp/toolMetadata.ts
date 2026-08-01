export interface McpToolSourceMetadata {
  kind: 'mcp'
  originalToolName: string
  serverId: string
  serverName: string
}

const metadataByTool = new WeakMap<object, McpToolSourceMetadata>()

export function registerMcpToolSource(tool: object, metadata: McpToolSourceMetadata) {
  metadataByTool.set(tool, { ...metadata })
}

export function getMcpToolSource(tool: object): McpToolSourceMetadata | null {
  const metadata = metadataByTool.get(tool)
  return metadata ? { ...metadata } : null
}
