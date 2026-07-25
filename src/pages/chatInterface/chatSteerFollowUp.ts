import type { ToolInvocationTrace } from '../../types/chat'

export function canInterruptStreamForSteer(
  toolInvocations: readonly Pick<ToolInvocationTrace, 'state' | 'toolName'>[],
) {
  return !toolInvocations.some((invocation) => invocation.state === 'running')
}

export function getLatestSuccessfulToolCompletionSignal(
  toolInvocations: readonly Pick<ToolInvocationTrace, 'completedAt' | 'id' | 'startedAt' | 'state'>[],
) {
  let latestInvocation:
    | Pick<ToolInvocationTrace, 'completedAt' | 'id' | 'startedAt' | 'state'>
    | null = null

  for (const invocation of toolInvocations) {
    if (invocation.state !== 'completed') {
      continue
    }

    if (!latestInvocation) {
      latestInvocation = invocation
      continue
    }

    const completionTime = invocation.completedAt ?? invocation.startedAt
    const latestCompletionTime = latestInvocation.completedAt ?? latestInvocation.startedAt

    if (
      completionTime > latestCompletionTime ||
      (completionTime === latestCompletionTime && invocation.id > latestInvocation.id)
    ) {
      latestInvocation = invocation
    }
  }

  if (!latestInvocation) {
    return null
  }

  return `${latestInvocation.id}:${latestInvocation.completedAt ?? latestInvocation.startedAt}`
}
