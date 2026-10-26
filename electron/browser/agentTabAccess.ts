import type { AgentBrowserTab } from './agentTabs'

/** All project browser tabs are accessible to the agent. The run's abort signal
 * remains the authority for cancelling operations in either kind of tab. */
export async function withBrowserTabAccess<T>(
  _tab: AgentBrowserTab,
  signal: AbortSignal | undefined,
  operation: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  const result = await operation(signal)
  if (signal?.aborted) throw new Error('Browser operation cancelled.')
  return result
}
