import type { AssistantWaitingIndicatorVariant, ToolInvocationTrace } from '../../types/chat'
import { isFileMutationTool } from './toolInvocationKinds'

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

  const hasFileMutationToolInvocation = toolInvocations.some((invocation) => isFileMutationTool(invocation.toolName))
  const hasNonFileMutationToolInvocation = toolInvocations.some(
    (invocation) => !isFileMutationTool(invocation.toolName),
  )

  if (hasFileMutationToolInvocation && !hasNonFileMutationToolInvocation) {
    return 'splash'
  }

  return waitingIndicatorVariant
}
