import type { Message } from '../types/chat'
import { isPlanRelativePath, type PlanToolResultPresentation } from './planContracts'
import { parseStructuredToolResultContent } from './toolResultContent'

type ToolInvocation = NonNullable<Message['toolInvocations']>[number]

interface CompletedPlanToolCall {
  presentation: PlanToolResultPresentation
  toolName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readPlanPresentation(value: unknown): PlanToolResultPresentation | null {
  if (!isRecord(value) || value.kind !== 'plan') return null
  if (
    typeof value.content !== 'string' ||
    typeof value.fileName !== 'string' ||
    (value.operation !== 'created' && value.operation !== 'updated') ||
    typeof value.planId !== 'string' ||
    typeof value.relativePath !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.updatedAt !== 'number' ||
    !isPlanRelativePath(value.relativePath)
  ) {
    return null
  }
  return value as unknown as PlanToolResultPresentation
}

function getCompletedPlanToolCalls(invocation: ToolInvocation): CompletedPlanToolCall[] {
  const directPresentation = invocation.state === 'completed'
    ? readPlanPresentation(invocation.resultPresentation)
    : null
  const calls: CompletedPlanToolCall[] = directPresentation
    ? [{ presentation: directPresentation, toolName: invocation.toolName }]
    : []

  if (invocation.toolName !== 'code_mode' || invocation.state !== 'completed' || !invocation.resultContent) {
    return calls
  }

  const parsedResult = parseStructuredToolResultContent(invocation.resultContent)
  const rawToolCalls = parsedResult.metadata?.semantics?.tool_calls
  if (!Array.isArray(rawToolCalls)) return calls

  for (const rawToolCall of rawToolCalls) {
    if (!isRecord(rawToolCall) || rawToolCall.status !== 'success' || typeof rawToolCall.name !== 'string') {
      continue
    }
    const presentation = readPlanPresentation(
      rawToolCall.result_presentation ?? rawToolCall.resultPresentation,
    )
    if (presentation) {
      calls.push({ presentation, toolName: rawToolCall.name })
    }
  }
  return calls
}

export function shouldAutoOpenPlanPreview(
  previousPlanKey: string | null,
  nextPlanKey: string | null,
  isRevertingPlan: boolean,
) {
  return nextPlanKey !== null && !isRevertingPlan && previousPlanKey !== nextPlanKey
}

export function hasPlanToolInvocation(messages: readonly Message[]) {
  return messages.some((message) =>
    message.toolInvocations?.some((invocation) =>
      invocation.toolName === 'plan_create' ||
      invocation.toolName === 'plan_edit' ||
      getCompletedPlanToolCalls(invocation).length > 0,
    ),
  )
}

export function getLatestCompletedPlanPresentation(messages: readonly Message[]) {
  let latestPresentation: PlanToolResultPresentation | null = null

  for (const message of messages) {
    for (const invocation of message.toolInvocations ?? []) {
      for (const call of getCompletedPlanToolCalls(invocation)) {
        latestPresentation = call.presentation
      }
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
      for (const call of getCompletedPlanToolCalls(invocation)) {
        if (call.toolName === 'plan_create' && call.presentation.operation === 'created') {
          createdPlanPaths.add(call.presentation.relativePath)
        }
      }
    }
  }

  return [...createdPlanPaths]
}
