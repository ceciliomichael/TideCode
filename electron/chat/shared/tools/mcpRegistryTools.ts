import type { ToolSet } from 'ai'
import { getMcpServerManager } from '../../../mcp/serverManager'
import type { AgentToolContext } from '../toolTypes'
import { resolveRunServiceBuildIdFromEnvironment } from '../../../runService/buildIdentity'

function isMcpRegistryRuntime() {
  if (typeof process === 'undefined') {
    return false
  }

  if (process.versions?.electron) {
    return true
  }

  try {
    resolveRunServiceBuildIdFromEnvironment(process.env)
    return true
  } catch {
    return false
  }
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
  if (!isMcpRegistryRuntime()) {
    return {}
  }

  try {
    return await getMcpServerManager().getToolSet(context.workspaceRootPath)
  } catch (error) {
    console.warn('Unable to add connected MCP tools to the Code Mode registry.', error)
    return {}
  }
}
