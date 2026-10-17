/** Session-local discovery receipts. Kept separate from execution permission and registry availability. */
export interface ToolDiscoveryState {
  obtainedTools: Set<string>
  discoveredMcpTools: Set<string>
}

const MAX_SESSION_STATES = 128
const sessions = new Map<string, ToolDiscoveryState>()

export function createToolDiscoveryState(
  conversationId: string | null | undefined,
  workspaceRootPath: string,
  chatMode: string,
  executionMode: string,
): ToolDiscoveryState {
  if (!conversationId) return { obtainedTools: new Set(), discoveredMcpTools: new Set() }
  const key = JSON.stringify([conversationId, workspaceRootPath, chatMode, executionMode])
  const existing = sessions.get(key)
  if (existing) {
    sessions.delete(key)
    sessions.set(key, existing)
    return existing
  }
  const state: ToolDiscoveryState = { obtainedTools: new Set(), discoveredMcpTools: new Set() }
  sessions.set(key, state)
  if (sessions.size > MAX_SESSION_STATES) {
    const oldest = sessions.keys().next().value
    if (oldest !== undefined) sessions.delete(oldest)
  }
  return state
}
