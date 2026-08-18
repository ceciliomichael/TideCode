import type { ChatMode, ChatStreamEvent, ToolInvocationTrace } from '../../src/types/chat'
import type { ChatStreamEventTarget } from '../chat/shared/runtimeStreamEvents'
import { TerminalSpinner } from './renderer'
import { TerminalProgressPresenter } from './progressPresenter'
import { StreamingTerminalMarkdown } from './terminalMarkdown'
import { getTerminalToolPresentationItems } from './desktopToolPresentation'
import { TerminalStreamAccumulator } from './streamDelta'
import type { TerminalScreenEventPresentation } from './terminalScreen'
import { renderTerminalToolRowText } from './terminalToolRow'

export interface TerminalEventSinkOptions {
  mode?: ChatMode
  modelId?: string
  providerId?: string
  workspaceRootPath?: string
  onDelta?: (delta: string) => void
  onComplete?: () => void
  onError?: (errorMsg: string) => void
  onEvent?: (event: ChatStreamEvent) => void
  showReasoning?: boolean
  presentation?: TerminalScreenEventPresentation
}

export function createTerminalChatEventSink(options: TerminalEventSinkOptions = {}): {
  sink: ChatStreamEventTarget
  getAccumulatedText: () => string
} {
  const progress = new TerminalProgressPresenter({
    mode: options.mode,
    modelId: options.modelId,
    providerId: options.providerId,
  })
  const markdownStream = new StreamingTerminalMarkdown()
  const toolSpinner = new TerminalSpinner()
  const isPresented = options.presentation !== undefined
  const contentAccumulator = new TerminalStreamAccumulator()
  const reasoningAccumulator = new TerminalStreamAccumulator()
  let hasStartedContent = false
  let reasoningStartedAt = 0
  const toolStartedAt = new Map<string, number>()

  // Hide blinking cursor during turn execution
  if (!isPresented) process.stdout.write('\x1b[?25l')

  // Start with live waiting progress spinner
  if (!isPresented) progress.startWaiting()

  const sink: ChatStreamEventTarget = {
    emit: (event: ChatStreamEvent) => {
      handleChatStreamEvent(event)
    },
    send: (_channel: string, payload: unknown) => {
      handleChatStreamEvent(payload as ChatStreamEvent)
    },
    isDestroyed: () => false,
  }

  function completePresentedReasoningBoundary() {
    if (!options.presentation || reasoningStartedAt === 0 || reasoningAccumulator.text.trim().length === 0) {
      return
    }

    const durationSeconds = Math.max(0.1, (Date.now() - reasoningStartedAt) / 1000)
    reasoningStartedAt = 0
    options.presentation.onReasoningCompleted(durationSeconds)
    reasoningAccumulator.reset()
  }

  function handleChatStreamEvent(event: ChatStreamEvent) {
    if (!event) return
    options.onEvent?.(event)

    switch (event.type) {
      case 'content_delta': {
        const delta = contentAccumulator.append(event.delta)
        if (!delta) break
        if (options.presentation) {
          completePresentedReasoningBoundary()
          if (!hasStartedContent) {
            hasStartedContent = true
            options.presentation.onContentStart()
          }
          options.presentation.onContentDelta(delta)
          options.onDelta?.(delta)
          break
        }

        if (!hasStartedContent) {
          hasStartedContent = true
          toolSpinner.stop()
          progress.cleanupLiveDisplay()
          progress.stop()
          process.stdout.write('\n')
        }

        markdownStream.append(delta)
        options.onDelta?.(delta)
        break
      }

      case 'reasoning_delta': {
        const delta = reasoningAccumulator.append(event.delta)
        if (!delta) break
        if (options.presentation) {
          if (reasoningStartedAt === 0) reasoningStartedAt = Date.now()
          if (options.showReasoning !== false) options.presentation.onReasoningDelta(delta)
          break
        }
        toolSpinner.stop()
        if (options.showReasoning !== false) {
          progress.appendReasoningDelta(delta)
        }
        break
      }

      case 'reasoning_completed': {
        if (options.presentation) {
          completePresentedReasoningBoundary()
          return
        }
        progress.completeReasoning()
        reasoningAccumulator.reset()
        if (!hasStartedContent) {
          progress.startWaiting()
        }
        break
      }

      case 'tool_invocation_started': {
        toolStartedAt.set(event.invocationId, event.startedAt)
        if (options.presentation) {
          completePresentedReasoningBoundary()
          options.presentation.onToolStarted(event.toolName)
          return
        }
        break
      }

      case 'tool_invocation_completed': {
        const invocation: ToolInvocationTrace = {
          argumentsText: event.argumentsText,
          completedAt: event.completedAt,
          id: event.invocationId,
          resultContent: event.resultContent,
          resultPresentation: event.resultPresentation,
          startedAt: toolStartedAt.get(event.invocationId) ?? event.completedAt,
          state: 'completed',
          toolName: event.toolName,
        }
        toolStartedAt.delete(event.invocationId)
        const items = getTerminalToolPresentationItems(invocation, options.workspaceRootPath)
        if (options.presentation) {
          for (const item of items) {
            options.presentation.onToolCompleted(item.label)
          }
          return
        }
        toolSpinner.stop()
        progress.cleanupLiveDisplay()

        for (const item of items) {
          console.log(`  ${renderTerminalToolRowText(item.label, 'completed')}`)
        }

        // Resume progress spinner while waiting for next turn
        if (!hasStartedContent) {
          progress.startWaiting()
        }
        break
      }

      case 'tool_invocation_failed': {
        const invocation: ToolInvocationTrace = {
          argumentsText: event.argumentsText,
          completedAt: event.completedAt,
          id: event.invocationId,
          resultContent: event.resultContent,
          resultPresentation: event.resultPresentation,
          startedAt: toolStartedAt.get(event.invocationId) ?? event.completedAt,
          state: 'failed',
          toolName: event.toolName,
        }
        toolStartedAt.delete(event.invocationId)
        const items = getTerminalToolPresentationItems(invocation, options.workspaceRootPath)
        if (options.presentation) {
          for (const item of items) {
            options.presentation.onToolFailed(item.label, event.errorMessage)
          }
          return
        }
        toolSpinner.stop()
        progress.cleanupLiveDisplay()

        for (const item of items) {
          console.log(`  ${renderTerminalToolRowText(item.label, 'failed', event.errorMessage)}`)
        }

        if (!hasStartedContent) {
          progress.startWaiting()
        }
        break
      }

      case 'completed': {
        if (options.presentation) {
          options.presentation.onCompleted()
          options.onComplete?.()
          return
        }
        toolSpinner.stop()
        progress.stop()
        markdownStream.finish()

        process.stdout.write('\x1b[?25h\n')
        options.onComplete?.()
        break
      }

      case 'aborted': {
        if (options.presentation) {
          options.presentation.onCompleted()
          options.onComplete?.()
          return
        }
        toolSpinner.stop('Turn cancelled.', '[STOP]')
        progress.stop()
        markdownStream.finish()

        process.stdout.write('\x1b[?25h\n')
        options.onComplete?.()
        break
      }

      case 'error': {
        if (options.presentation) {
          options.presentation.onCompleted()
          options.onError?.(event.errorMessage || 'Unknown error')
          return
        }
        toolSpinner.fail(event.errorMessage || 'An error occurred during turn execution.')
        progress.stop()
        markdownStream.finish()

        process.stdout.write('\x1b[?25h\n')
        options.onError?.(event.errorMessage || 'Unknown error')
        break
      }
    }
  }

  return {
    sink,
    getAccumulatedText: () => contentAccumulator.text,
  }
}
