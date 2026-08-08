import type { Message } from '../types/chat'
import type { PlanToolResultPresentation } from './planContracts'

const PLAN_TOOL_NAMES = new Set(['plan_create', 'plan_edit'])

export function hasPlanToolInvocation(messages: readonly Message[]) {
  return messages.some((message) =>
    message.toolInvocations?.some((invocation) => PLAN_TOOL_NAMES.has(invocation.toolName)),
  )
}

export function getLatestCompletedPlanPresentation(messages: readonly Message[]) {
  let latestPresentation: PlanToolResultPresentation | null = null

  for (const message of messages) {
    for (const invocation of message.toolInvocations ?? []) {
      if (invocation.state !== 'completed' || invocation.resultPresentation?.kind !== 'plan') {
        continue
      }

      latestPresentation = invocation.resultPresentation
    }
  }

  return latestPresentation
}

export function getPlanPathsCreatedByRevertedUserMessage(messages: readonly Message[], messageId: string) {
  const targetIndex = messages.findIndex((message) => message.id === messageId && message.role === 'user')
  if (targetIndex < 0) {
    return []
  }

  const createdPlanPaths = new Set<string>()
  for (const message of messages.slice(targetIndex + 1)) {
    for (const invocation of message.toolInvocations ?? []) {
      if (
        invocation.toolName !== 'plan_create' ||
        invocation.state !== 'completed' ||
        invocation.resultPresentation?.kind !== 'plan' ||
        invocation.resultPresentation.operation !== 'created'
      ) {
        continue
      }

      createdPlanPaths.add(invocation.resultPresentation.relativePath)
    }
  }

  return [...createdPlanPaths]
}
