import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  ChatStreamEvent,
  Message,
  ToolInvocationResultPresentation,
} from '../../../src/types/chat'
import { TERMINATED_TOOL_EXECUTION_MESSAGE } from '../../../src/lib/toolResultContent'
import { recordToolFreshness } from '../history/eventStore'
import type { AgentToolExecutionResult } from './toolTypes'
import {
  createCanonicalToolResultContent,
  normalizeToolExecutionResult,
} from './toolReplay'

const CHAT_STREAM_EVENT_CHANNEL = 'chat:stream:event'

interface ToolInvocationState {
  argumentsText: string
  startedAt: number
  toolName: string
}

export interface RuntimeStreamPart {
  type: string
  [key: string]: unknown
}

export interface ChatStreamEventTarget {
  send?: (channel: string, payload: unknown) => void
  emit?: (event: ChatStreamEvent) => void
  isDestroyed?: () => boolean
}

export function emitChatStreamEvent(
  target: WebContents | ChatStreamEventTarget | null | undefined,
  payload: ChatStreamEvent,
) {
  if (!target) {
    return
  }

  if (typeof target.isDestroyed === 'function' && target.isDestroyed()) {
    return
  }

  if (typeof target.send === 'function') {
    target.send(CHAT_STREAM_EVENT_CHANNEL, payload)
  } else if (typeof (target as { emit?: (e: ChatStreamEvent) => void }).emit === 'function') {
    ;(target as { emit: (e: ChatStreamEvent) => void }).emit(payload)
  }
}

function isStreamPart(part: RuntimeStreamPart, type: string): boolean {
  return part.type === type
}

function stringifyToolArguments(input: unknown) {
  try {
    return JSON.stringify(input ?? {}, null, 2)
  } catch {
    return '{}'
  }
}
function parseToolArguments(input: string) {
  try {
    return JSON.parse(input) as unknown
  } catch {
    return null
  }
}

function getToolErrorMessage(toolName: string, error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim().length > 0) {
      return message
    }
  }

  return `Tool ${toolName} failed before returning a result.`
}

function resolveDisplayedInvocation(toolName: string, input: unknown) {
  return { argumentsValue: input, toolName }
}


function createSyntheticToolMessage(
  invocationId: string,
  toolName: string,
  argumentsValue: unknown,
  completedAt: number,
  result: AgentToolExecutionResult,
  bodyOverride?: string,
): Message {
  return {
    content: createCanonicalToolResultContent({
      argumentsValue,
      ...(bodyOverride === undefined ? {} : { body: bodyOverride }),
      result,
      toolCallId: invocationId,
      toolName,
    }),
    id: randomUUID(),
    role: 'tool',
    timestamp: completedAt,
    toolCallId: invocationId,
  }
}

function getToolResultPresentation(result: AgentToolExecutionResult): ToolInvocationResultPresentation | undefined {
  return result.resultPresentation
}

function emitTerminatedToolInvocations(
  input: ProcessRuntimeStreamInput,
  invocationStateById: Map<string, ToolInvocationState>,
) {
  if (invocationStateById.size === 0) {
    return
  }

  const completedAt = Date.now()
  for (const [invocationId, invocation] of invocationStateById) {
    const argumentsValue = parseToolArguments(invocation.argumentsText)
    const terminatedResult: AgentToolExecutionResult = {
      body: TERMINATED_TOOL_EXECUTION_MESSAGE,
      displayBody: TERMINATED_TOOL_EXECUTION_MESSAGE,
      status: 'error',
      summary: TERMINATED_TOOL_EXECUTION_MESSAGE,
    }
    const syntheticMessage = createSyntheticToolMessage(
      invocationId,
      invocation.toolName,
      argumentsValue,
      completedAt,
      terminatedResult,
    )
    const displaySyntheticMessage = createSyntheticToolMessage(
      invocationId,
      invocation.toolName,
      argumentsValue,
      completedAt,
      terminatedResult,
      TERMINATED_TOOL_EXECUTION_MESSAGE,
    )

    emitChatStreamEvent(input.webContents, {
      argumentsText: invocation.argumentsText,
      completedAt,
      errorMessage: TERMINATED_TOOL_EXECUTION_MESSAGE,
      invocationId,
      resultContent: displaySyntheticMessage.content,
      streamId: input.streamId,
      syntheticMessage,
      toolName: invocation.toolName,
      type: 'tool_invocation_failed',
    })
  }
  invocationStateById.clear()
}

interface ProcessRuntimeStreamInput {
  abortController: AbortController
  conversationId: string | null
  fullStream: AsyncIterable<RuntimeStreamPart>
  queueHistoryWrite: (action: () => Promise<unknown>) => void
  streamId: string
  webContents: WebContents | ChatStreamEventTarget
}

export async function processRuntimeStream(input: ProcessRuntimeStreamInput) {
  const { conversationId, queueHistoryWrite } = input
  const invocationStateById = new Map<string, ToolInvocationState>()
  let completedStepCount = 0
  let lastFinishReason: string | null = null

  try {
      for await (const part of input.fullStream) {
        // The provider/tool iterator may still yield after cancellation while
        // it unwinds; do not forward those late events or persist more progress.
        if (input.abortController.signal.aborted) {
          continue
        }

        if (isStreamPart(part, 'text-delta') && typeof part.text === 'string') {
          emitChatStreamEvent(input.webContents, {
            delta: part.text,
            streamId: input.streamId,
            type: 'content_delta',
          })
          continue
        }
  
        if (isStreamPart(part, 'reasoning-delta') && typeof part.text === 'string') {
          emitChatStreamEvent(input.webContents, {
            delta: part.text,
            streamId: input.streamId,
            type: 'reasoning_delta',
          })
          continue
        }
  
        if (isStreamPart(part, 'reasoning-end')) {
          emitChatStreamEvent(input.webContents, {
            streamId: input.streamId,
            type: 'reasoning_completed',
          })
          continue
        }
  
        if (isStreamPart(part, 'tool-input-start') && typeof part.id === 'string' && typeof part.toolName === 'string') {
          const startedAt = Date.now()
          const displayedInvocation = resolveDisplayedInvocation(part.toolName, undefined)
          invocationStateById.set(part.id, {
            argumentsText: '',
            startedAt,
            toolName: displayedInvocation.toolName,
          })
          emitChatStreamEvent(input.webContents, {
            argumentsText: '',
            invocationId: part.id,
            startedAt,
            streamId: input.streamId,
            toolName: displayedInvocation.toolName,
            type: 'tool_invocation_started',
          })
          continue
        }
  
        if (isStreamPart(part, 'tool-input-delta') && typeof part.id === 'string' && typeof part.delta === 'string') {
          const currentState = invocationStateById.get(part.id) ?? {
            argumentsText: '',
            startedAt: Date.now(),
            toolName: 'tool',
          }
          const nextArgumentsText = currentState.argumentsText + part.delta
          const outerToolName = typeof part.toolName === 'string' ? part.toolName : currentState.toolName
          const displayedInvocation = resolveDisplayedInvocation(outerToolName, parseToolArguments(nextArgumentsText))
          const displayedArgumentsText = displayedInvocation.toolName === outerToolName
            ? nextArgumentsText
            : stringifyToolArguments(displayedInvocation.argumentsValue)
          invocationStateById.set(part.id, {
            ...currentState,
            argumentsText: displayedArgumentsText,
            toolName: displayedInvocation.toolName,
          })
          emitChatStreamEvent(input.webContents, {
            argumentsText: displayedArgumentsText,
            invocationId: part.id,
            streamId: input.streamId,
            toolName: displayedInvocation.toolName,
            type: 'tool_invocation_delta',
          })
          continue
        }
  
        if (
          isStreamPart(part, 'tool-call') &&
          typeof part.toolCallId === 'string' &&
          typeof part.toolName === 'string'
        ) {
          const currentState = invocationStateById.get(part.toolCallId)
          const displayedInvocation = resolveDisplayedInvocation(part.toolName, part.input ?? part.args)
          const argumentsText = stringifyToolArguments(displayedInvocation.argumentsValue)
          if (!currentState) {
            const startedAt = Date.now()
            invocationStateById.set(part.toolCallId, {
              argumentsText,
              startedAt,
              toolName: displayedInvocation.toolName,
            })
            emitChatStreamEvent(input.webContents, {
              argumentsText,
              invocationId: part.toolCallId,
              startedAt,
              streamId: input.streamId,
              toolName: displayedInvocation.toolName,
              type: 'tool_invocation_started',
            })
            continue
          }
  
          if (currentState.argumentsText !== argumentsText) {
            invocationStateById.set(part.toolCallId, {
              ...currentState,
              argumentsText,
              toolName: displayedInvocation.toolName,
            })
            emitChatStreamEvent(input.webContents, {
              argumentsText,
              invocationId: part.toolCallId,
              streamId: input.streamId,
              toolName: displayedInvocation.toolName,
              type: 'tool_invocation_delta',
            })
          }
          continue
        }
  
        if (
          isStreamPart(part, 'tool-result') &&
          typeof part.toolCallId === 'string' &&
          typeof part.toolName === 'string'
        ) {
          if (input.abortController.signal.aborted) {
            continue
          }
  
          const completedAt = Date.now()
          const toolName = part.toolName
          const normalizedResult = normalizeToolExecutionResult(toolName, part.output ?? part.result)
          const modelResult = normalizedResult
          const displayedInvocation = resolveDisplayedInvocation(
            toolName,
            part.input ?? part.args,
          )
          const displayedArgumentsText = stringifyToolArguments(displayedInvocation.argumentsValue)
          if (conversationId) {
            queueHistoryWrite(() => recordToolFreshness({
              conversationId,
              status: normalizedResult.status,
              subject: normalizedResult.subject,
              toolName,
            }))
          }
          const syntheticMessage = createSyntheticToolMessage(
            part.toolCallId,
            part.toolName,
            part.input ?? part.args,
            completedAt,
            modelResult,
          )
          const displaySyntheticMessage = createSyntheticToolMessage(
            part.toolCallId,
            displayedInvocation.toolName,
            displayedInvocation.argumentsValue,
            completedAt,
            normalizedResult,
            normalizedResult.displayBody,
          )
          const payload = {
            argumentsText: displayedArgumentsText,
            completedAt,
            invocationId: part.toolCallId,
            resultContent: displaySyntheticMessage.content,
            ...(getToolResultPresentation(normalizedResult)
              ? { resultPresentation: getToolResultPresentation(normalizedResult) }
              : {}),
            streamId: input.streamId,
            syntheticMessage,
            toolName: displayedInvocation.toolName,
          } as const
  
          invocationStateById.delete(part.toolCallId)
          if (normalizedResult.status === 'error') {
            emitChatStreamEvent(input.webContents, {
              ...payload,
              errorMessage: normalizedResult.summary,
              type: 'tool_invocation_failed',
            })
            continue
          }
  
          emitChatStreamEvent(input.webContents, {
            ...payload,
            type: 'tool_invocation_completed',
          })
          continue
        }
  
        if (
          isStreamPart(part, 'tool-error') &&
          typeof part.toolCallId === 'string' &&
          typeof part.toolName === 'string'
        ) {
          if (input.abortController.signal.aborted) {
            continue
          }
  
          const currentState = invocationStateById.get(part.toolCallId)
          const completedAt = Date.now()
          const displayedInvocation = resolveDisplayedInvocation(part.toolName, part.input ?? part.args)
          const displayedArgumentsText = stringifyToolArguments(displayedInvocation.argumentsValue)
          const errorMessage = getToolErrorMessage(part.toolName, part.error)
          const syntheticMessage = createSyntheticToolMessage(
            part.toolCallId,
            part.toolName,
            part.input ?? part.args,
            completedAt,
            {
              body: errorMessage,
              status: 'error',
              summary: errorMessage,
            },
          )
          const displaySyntheticMessage = createSyntheticToolMessage(
            part.toolCallId,
            displayedInvocation.toolName,
            displayedInvocation.argumentsValue,
            completedAt,
            {
              body: errorMessage,
              status: 'error',
              summary: errorMessage,
            },
          )
  
          invocationStateById.delete(part.toolCallId)
          emitChatStreamEvent(input.webContents, {
            argumentsText: currentState?.argumentsText ?? displayedArgumentsText,
            completedAt,
            errorMessage,
            invocationId: part.toolCallId,
            resultContent: displaySyntheticMessage.content,
            streamId: input.streamId,
            syntheticMessage,
            toolName: displayedInvocation.toolName,
            type: 'tool_invocation_failed',
          })
        }
  
        if (isStreamPart(part, 'finish')) {
          completedStepCount += 1
          lastFinishReason = typeof part.finishReason === 'string' ? part.finishReason : null
        }
      }
  } catch (error) {
    if (input.abortController.signal.aborted) {
      emitTerminatedToolInvocations(input, invocationStateById)
    }
    throw error
  }

  if (input.abortController.signal.aborted) {
    emitTerminatedToolInvocations(input, invocationStateById)
  }

  return {
    completedStepCount,
    lastFinishReason,
    wasAborted: input.abortController.signal.aborted,
  }
}
