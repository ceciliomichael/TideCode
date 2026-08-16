import type { ChatStreamEvent, Message } from '../../src/types/chat'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../../src/lib/contextCompactionSettings'
import { createChatAssistantDraftManager } from '../../src/hooks/chatAssistantDrafts'
import type { ConversationRuntimeStatePatch } from '../../src/hooks/chatMessageSendTypes'
import type { CliSessionState } from './types'

export interface CliTurnMessageCollectorOptions {
  onConversationMessagesUpdated?: (
    messages: Message[],
    options?: { immediate?: boolean },
    hint?: { deltaCharCount?: number },
  ) => void
  onConversationRuntimeStateUpdated?: (input: ConversationRuntimeStatePatch) => void
  onProjectionUpdated?: (messages: Message[]) => void
  onTextStreamingPulse?: () => void
  onTextStreamingStopped?: () => void
}

export class CliTurnMessageCollector {
  private readonly manager: ReturnType<typeof createChatAssistantDraftManager>
  private readonly projectedMessages: Message[]
  private wasAborted = false
  private failureMessage: string | undefined

  constructor(state: CliSessionState, options: CliTurnMessageCollectorOptions = {}) {
    this.projectedMessages = [...state.messages]
    const notifyProjectionUpdated = () => options.onProjectionUpdated?.([...this.projectedMessages])
    this.manager = createChatAssistantDraftManager({
      appendLocalMessage: (_conversationId, message) => {
        this.projectedMessages.push(message)
        notifyProjectionUpdated()
      },
      conversationId: state.conversationId,
      initialConversationMessages: state.messages,
      markTextStreamingPulse: () => options.onTextStreamingPulse?.(),
      onConversationMessagesUpdated: options.onConversationMessagesUpdated ?? (() => undefined),
      providerId: state.providerId,
      removeLocalMessage: (_conversationId, messageId) => {
        const messageIndex = this.projectedMessages.findIndex((message) => message.id === messageId)
        if (messageIndex < 0) return
        this.projectedMessages.splice(messageIndex, 1)
        notifyProjectionUpdated()
      },
      runtimeSelection: {
        contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
        hasConfiguredProvider: true,
        modelId: state.modelId,
        providerId: state.providerId,
        providerLabel: state.providerId,
        reasoningEffort: state.reasoningEffort,
        terminalExecutionMode: state.terminalExecutionMode,
      },
      stopTextStreaming: () => options.onTextStreamingStopped?.(),
      updateConversationRuntimeState: (_conversationId, input) => {
        options.onConversationRuntimeStateUpdated?.(input)
        notifyProjectionUpdated()
      },
      updateLocalMessage: (_conversationId, messageId, updater) => {
        const messageIndex = this.projectedMessages.findIndex((message) => message.id === messageId)
        if (messageIndex < 0) return
        this.projectedMessages[messageIndex] = updater(this.projectedMessages[messageIndex])
        notifyProjectionUpdated()
      },
    })
    this.manager.appendPlaceholderDraft()
  }

  handleEvent(event: ChatStreamEvent): void {
    switch (event.type) {
      case 'content_delta':
        this.manager.handleContentDelta(event.delta)
        break
      case 'reasoning_delta':
        this.manager.handleReasoningDelta(event.delta)
        break
      case 'reasoning_completed':
        this.manager.handleReasoningCompleted()
        break
      case 'compaction_committed':
        this.manager.handleCompactionCommitted()
        break
      case 'tool_invocation_started':
        this.manager.handleToolInvocationStarted(event.invocationId, event)
        break
      case 'tool_invocation_delta':
        this.manager.handleToolInvocationDelta(event.invocationId, event)
        break
      case 'tool_invocation_decision_requested':
        this.manager.handleToolInvocationDecisionRequested(event.invocationId, {
          decisionRequest: {
            allowCustomAnswer: event.allowCustomAnswer,
            kind: event.kind,
            options: event.options,
            prompt: event.prompt,
            streamId: event.streamId,
          },
          toolName: event.toolName,
        })
        break
      case 'tool_invocation_completed':
        this.manager.handleSyntheticToolMessage(event.syntheticMessage)
        this.manager.handleToolInvocationCompleted(event.invocationId, event)
        break
      case 'tool_invocation_failed':
        this.manager.handleSyntheticToolMessage(event.syntheticMessage)
        this.manager.handleToolInvocationFailed(event.invocationId, event)
        break
      case 'steer_messages_consumed':
        this.manager.handleSteerMessagesConsumed(event.messages)
        break
      case 'aborted':
        this.wasAborted = true
        break
      case 'error':
        this.failureMessage = event.errorMessage
        break
      default:
        break
    }
  }

  finalize(): Message[] {
    return this.manager.finalizeStreamedMessages(this.wasAborted, this.failureMessage) ?? []
  }
}
