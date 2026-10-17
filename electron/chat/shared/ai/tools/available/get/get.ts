import type { AgentToolRegistryEntry } from '../../../../tools/registry'
export interface AvailableToolContract {
  name: string
  description: string
  signature: string
  inputSchema: AgentToolRegistryEntry['inputSchema']
}
export function getAvailableApi(tool: AgentToolRegistryEntry, name: string, signature: string): AvailableToolContract {
  return { name, description: tool.description, signature, inputSchema: tool.inputSchema }
}
