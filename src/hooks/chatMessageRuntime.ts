import type {
  AppTerminalExecutionMode,
  ChatMode,
  ChatProviderId,
  Message,
  ReasoningEffort,
  ToolDecisionRequest,
  ToolInvocationTrace,
} from '../types/chat'
import type { ContextCompactionSettings } from '../lib/contextCompactionSettings'
import { toUserFacingErrorMessage } from '../lib/userFacingError'
import {
  hasMeaningfulAssistantContent,
  normalizeAssistantMessageContent,
} from '../lib/chatMessageContent'

export interface ChatRuntimeSelection {
  contextCompaction: ContextCompactionSettings
  hasConfiguredProvider: boolean
  modelId: string
  providerId: ChatProviderId | null
  providerLabel: string | null
  reasoningEffort: ReasoningEffort
  terminalExecutionMode: AppTerminalExecutionMode
}

interface StreamAssistantResponseInput {
  agentContextRootPath: string
  cacheScopeId: string
  chatMode: ChatMode
  conversationId: string
  contextCompaction: ContextCompactionSettings
  messages: Message[]
  modelId: string
  onContentDelta: (delta: string) => void
  onReasoningCompleted: () => void
  onReasoningDelta: (delta: string) => void
  onStreamStarted: (streamId: string) => void
  onSyntheticToolMessage: (message: Message) => void
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  terminalExecutionMode: AppTerminalExecutionMode
  onToolInvocationCompleted: (
    invocationId: string,
    nextValue: Pick<ToolInvocationTrace, 'argumentsText' | 'completedAt' | 'resultContent' | 'resultPresentation' | 'toolName'>,
  ) => void
  onToolInvocationFailed: (
    invocationId: string,
    nextValue: Pick<ToolInvocationTrace, 'argumentsText' | 'completedAt' | 'resultContent' | 'resultPresentation' | 'toolName'>,
  ) => void
  onToolInvocationStarted: (
    invocationId: string,
    nextValue: Pick<ToolInvocationTrace, 'argumentsText' | 'startedAt' | 'toolName'>,
  ) => void
  onToolInvocationDelta: (
    invocationId: string,
    nextValue: Pick<ToolInvocationTrace, 'argumentsText' | 'toolName'>,
  ) => void
  onToolInvocationDecisionRequested: (
    invocationId: string,
    nextValue: Pick<ToolInvocationTrace, 'toolName'> & {
      decisionRequest: ToolDecisionRequest
    },
  ) => void
}

interface StreamAssistantResponseOutput {
  wasAborted: boolean
}

export function hasMeaningfulAssistantOutput(message: Message) {
  return message.role === 'assistant' && hasMeaningfulAssistantContent(message)
}

export function normalizeAssistantMessage(message: Message): Message {
  if (message.role !== 'assistant') {
    return message
  }

  const normalizedContent = normalizeAssistantMessageContent(message)

  return {
    ...message,
    content: normalizedContent.content,
    reasoningContent: normalizedContent.reasoningContent.length > 0 ? normalizedContent.reasoningContent : undefined,
  }
}

export function toErrorMessage(error: unknown, fallbackMessage: string) {
  return toUserFacingErrorMessage(error, fallbackMessage)
}

export function upsertToolInvocation(
  toolInvocations: ToolInvocationTrace[],
  invocationId: string,
  updater: (currentValue: ToolInvocationTrace | null) => ToolInvocationTrace,
) {
  const existingInvocation = toolInvocations.find((invocation) => invocation.id === invocationId) ?? null
  const nextInvocation = updater(existingInvocation)

  if (!existingInvocation) {
    return [...toolInvocations, nextInvocation]
  }

  return toolInvocations.map((invocation) => (invocation.id === invocationId ? nextInvocation : invocation))
}

export async function streamAssistantResponse(
  input: StreamAssistantResponseInput,
): Promise<StreamAssistantResponseOutput> {
  let streamId: string | null = null

  return new Promise<StreamAssistantResponseOutput>((resolve, reject) => {
    const queuedEvents: Parameters<Parameters<typeof window.tidecodeChat.onStreamEvent>[0]>[0][] = []

    const handleStreamEvent = (event: Parameters<Parameters<typeof window.tidecodeChat.onStreamEvent>[0]>[0]) => {
      if (event.type === 'content_delta') {
        input.onContentDelta(event.delta)
        return
      }

      if (event.type === 'reasoning_delta') {
        input.onReasoningDelta(event.delta)
        return
      }

      if (event.type === 'reasoning_completed') {
        input.onReasoningCompleted()
        return
      }

      if (event.type === 'tool_invocation_started') {
        input.onToolInvocationStarted(event.invocationId, {
          argumentsText: event.argumentsText,
          startedAt: event.startedAt,
          toolName: event.toolName,
        })
        return
      }

      if (event.type === 'tool_invocation_delta') {
        input.onToolInvocationDelta(event.invocationId, {
          argumentsText: event.argumentsText,
          toolName: event.toolName,
        })
        return
      }

      if (event.type === 'tool_invocation_decision_requested') {
        input.onToolInvocationDecisionRequested(event.invocationId, {
          decisionRequest: {
            allowCustomAnswer: event.allowCustomAnswer,
            kind: event.kind,
            options: event.options,
            prompt: event.prompt,
            streamId: event.streamId,
          },
          toolName: event.toolName,
        })
        return
      }

      if (event.type === 'tool_invocation_completed') {
        input.onSyntheticToolMessage(event.syntheticMessage)
        input.onToolInvocationCompleted(event.invocationId, {
          argumentsText: event.argumentsText,
          completedAt: event.completedAt,
          resultContent: event.resultContent,
          resultPresentation: event.resultPresentation,
          toolName: event.toolName,
        })
        return
      }

      if (event.type === 'tool_invocation_failed') {
        input.onSyntheticToolMessage(event.syntheticMessage)
        input.onToolInvocationFailed(event.invocationId, {
          argumentsText: event.argumentsText,
          completedAt: event.completedAt,
          resultContent: event.resultContent,
          resultPresentation: event.resultPresentation,
          toolName: event.toolName,
        })
        return
      }

      if (event.type === 'completed') {
        unsubscribe()
        resolve({ wasAborted: false })
        return
      }

      if (event.type === 'aborted') {
        unsubscribe()
        resolve({ wasAborted: true })
        return
      }

      if (event.type === 'error') {
        unsubscribe()
        reject(new Error(event.errorMessage))
      }
    }

    const unsubscribe = window.tidecodeChat.onStreamEvent((event) => {
      if (!streamId) {
        queuedEvents.push(event)
        return
      }

      if (event.streamId !== streamId) {
        return
      }

      handleStreamEvent(event)
    })

    void window.tidecodeChat
      .startStream({
        messages: input.messages,
        agentContextRootPath: input.agentContextRootPath,
        cacheScopeId: input.cacheScopeId,
        chatMode: input.chatMode,
        conversationId: input.conversationId,
        contextCompaction: input.contextCompaction,
        modelId: input.modelId,
        providerId: input.providerId,
        reasoningEffort: input.reasoningEffort,
        terminalExecutionMode: input.terminalExecutionMode,
      })
      .then((result) => {
        streamId = result.streamId
        input.onStreamStarted(result.streamId)

        for (const event of queuedEvents) {
          if (event.streamId !== result.streamId) {
            continue
          }

          handleStreamEvent(event)
        }

        queuedEvents.length = 0
      })
      .catch((error) => {
        unsubscribe()
        reject(error)
      })
  })
}
