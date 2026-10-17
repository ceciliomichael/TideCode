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
 * Connected MCP capabilities share the internal exec registry with local
 * APIs and are discovered by tools.available.search.
 */
export async function createConnectedMcpRegistryTools(
  context: AgentToolContext,
): Promise<ToolSet> {
  if (!isMcpRegistryRuntime()) {
    return {}
  }

  return getMcpServerManager().getToolSet(context.workspaceRootPath)
}
