import type { ToolInvocationTrace } from '../../src/types/chat'
import {
  getToolInvocationDisplayEntries,
  getToolInvocationHeaderLabel,
} from '../../src/components/chat/toolInvocationPresentation'

export interface TerminalToolPresentationItem {
  id: string
  label: string
  status: 'completed' | 'failed'
}

export function getTerminalToolPresentationItems(
  invocation: ToolInvocationTrace,
  workspaceRootPath?: string | null,
): TerminalToolPresentationItem[] {
  if (invocation.state === 'running') return []

  return getToolInvocationDisplayEntries(invocation).flatMap((entry) => {
    if (entry.invocation.state === 'running') return []
    return [{
      id: entry.key,
      label: getToolInvocationHeaderLabel(entry.invocation, undefined, workspaceRootPath),
      status: entry.invocation.state,
    }]
  })
}
