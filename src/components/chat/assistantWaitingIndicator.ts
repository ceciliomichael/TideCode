import type { AssistantWaitingIndicatorVariant, ToolInvocationTrace } from '../../types/chat'
import { isFileMutationTool } from './toolInvocationKinds'
import { resolveToolInvocationForPresentation } from './toolInvocationPresentation'

interface ResolveAssistantWaitingIndicatorVariantInput {
  hasVisibleAssistantText: boolean
  toolInvocations: readonly ToolInvocationTrace[]
  waitingIndicatorVariant: AssistantWaitingIndicatorVariant
}

export function resolveAssistantWaitingIndicatorVariant({
  hasVisibleAssistantText,
  toolInvocations,
  waitingIndicatorVariant,
}: ResolveAssistantWaitingIndicatorVariantInput): AssistantWaitingIndicatorVariant {
  if (waitingIndicatorVariant === 'rate_limit_retry' || hasVisibleAssistantText) {
    return waitingIndicatorVariant
  }

  const displayInvocations = toolInvocations.map(resolveToolInvocationForPresentation)
  const hasFileMutationToolInvocation = displayInvocations.some((invocation) => isFileMutationTool(invocation.toolName))
  const hasNonFileMutationToolInvocation = displayInvocations.some(
    (invocation) => !isFileMutationTool(invocation.toolName),
  )

  if (hasFileMutationToolInvocation && !hasNonFileMutationToolInvocation) {
    return 'splash'
  }

  return waitingIndicatorVariant
}
