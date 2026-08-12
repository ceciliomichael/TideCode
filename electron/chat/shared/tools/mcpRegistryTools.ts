import type { ToolSet } from 'ai'
import type { AgentToolContext } from '../toolTypes'

function isElectronRuntime() {
  return typeof process !== 'undefined' && Boolean(process.versions?.electron)
}

/**
 * Returns connected MCP tools as ordinary registry inputs for Code Mode.
 *
 * The legacy `mcp_tool_search`/`execute_mcp` pair remains available to direct
 * mode for history compatibility. Code Mode must not search through that
 * second protocol: connected MCP tools are catalogued beside filesystem,
 * terminal, memory, and other local tools and are invoked through the same
 * registry bridge.
 */
export async function createConnectedMcpRegistryTools(
  context: AgentToolContext,
): Promise<ToolSet> {
  if (!isElectronRuntime()) {
    return {}
  }

  try {
    const { getMcpServerManager } = await import('../../../mcp/serverManager')
    return await getMcpServerManager().getToolSet(context.workspaceRootPath)
  } catch (error) {
    console.warn('Unable to add connected MCP tools to the Code Mode registry.', error)
    return {}
  }
}
