import { memo, useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ToolInvocationTrace } from '../../types/chat'
import { normalizeMarkdownText } from '../../lib/chatMessageContent'
import { DiffViewer } from './DiffViewer'
import { ChangeDiffResult } from './FileChangeDiffResult'
import { MarkdownRenderer } from './MarkdownRenderer'
import { TerminalToolResult } from './TerminalToolResult'
import { ToolDecisionRequestCard, type ToolDecisionSubmission } from './ToolDecisionRequestCard'
import { getToolInvocationHeaderLabel } from './toolInvocationPresentation'
import { isFileEditTool, isFileWriteTool } from './toolInvocationKinds'
import { isKanbanTool } from './kanbanToolInvocationKinds'
import { KanbanToolResult } from './KanbanToolResult'
import { WebToolResult } from './WebToolResult'
import { getToolResultDisplayBody, parseStructuredToolResultContent } from '../../lib/toolResultContent'

interface ToolInvocationBlockProps {
  invocation: ToolInvocationTrace
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void
  workspaceRootPath?: string | null
}

const MIN_RUNNING_LABEL_DURATION_MS = 200

function shouldHoldRunningLabel(invocation: ToolInvocationTrace) {
  return !isFileWriteTool(invocation.toolName) && !isFileEditTool(invocation.toolName)
}

function renderDiffCountSummary(invocation: ToolInvocationTrace) {
  if (invocation.state !== 'completed') {
    return null
  }

  const resultPresentation = invocation.resultPresentation
  let addedLineCount = 0
  let removedLineCount = 0

  if (resultPresentation?.kind === 'file_diff') {
    addedLineCount = resultPresentation.addedLineCount ?? 0
    removedLineCount = resultPresentation.removedLineCount ?? 0
  } else if (resultPresentation?.kind === 'change_diff') {
    for (const change of resultPresentation.changes) {
      addedLineCount += change.addedLineCount ?? 0
      removedLineCount += change.removedLineCount ?? 0
    }
  } else {
    return null
  }

  if (addedLineCount > 0 && removedLineCount > 0) {
    return (
      <>
        <span className="text-emerald-500">{`+${addedLineCount}`}</span>
        <span className="text-red-500">{`-${removedLineCount}`}</span>
      </>
    )
  }

  if (addedLineCount > 0) {
    return <span className="text-emerald-500">{`+${addedLineCount}`}</span>
  }

  if (removedLineCount > 0) {
    return <span className="text-red-500">{`-${removedLineCount}`}</span>
  }

  return null
}


export const ToolInvocationBlock = memo(function ToolInvocationBlock({
  invocation,
  onToolDecisionSubmit,
  workspaceRootPath = null,
}: ToolInvocationBlockProps) {
  const displayInvocation = invocation
  const [isOpen, setIsOpen] = useState(false)
  const [submittedDecisionRequestKey, setSubmittedDecisionRequestKey] = useState<string | null>(null)
  const [displayedState, setDisplayedState] = useState<ToolInvocationTrace['state']>(invocation.state)
  const decisionRequestKey = invocation.decisionRequest
    ? [
        invocation.id,
        invocation.decisionRequest.streamId,
        invocation.decisionRequest.kind,
        invocation.decisionRequest.options.map((option) => option.id).join(','),
      ].join(':')
    : null

  useEffect(() => {
    const hasUnsubmittedDecisionRequest =
      decisionRequestKey !== null && decisionRequestKey !== submittedDecisionRequestKey
    const shouldAutoOpenReadyImplementCompletion =
      displayInvocation.toolName === 'ready_implement' && displayInvocation.state === 'completed' && submittedDecisionRequestKey === null

    if (hasUnsubmittedDecisionRequest || shouldAutoOpenReadyImplementCompletion) {
      setIsOpen(true)
    }
  }, [decisionRequestKey, displayInvocation, submittedDecisionRequestKey])

  useEffect(() => {
    if (displayInvocation.state === 'running') {
      setDisplayedState('running')
      return undefined
    }

    if (!shouldHoldRunningLabel(displayInvocation)) {
      setDisplayedState(displayInvocation.state)
      return undefined
    }

    const elapsedSinceStart = Date.now() - displayInvocation.startedAt
    const remainingRunningLabelTime = Math.max(0, MIN_RUNNING_LABEL_DURATION_MS - elapsedSinceStart)

    if (remainingRunningLabelTime === 0) {
      setDisplayedState(displayInvocation.state)
      return undefined
    }

    setDisplayedState('running')
    const timeoutId = window.setTimeout(() => {
      setDisplayedState(displayInvocation.state)
    }, remainingRunningLabelTime)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [displayInvocation])

  const hasPendingDecision = invocation.decisionRequest !== undefined
  const isRunning = displayedState === 'running'
  const disableHeaderToggle = isRunning && !hasPendingDecision

  const headerLabel = getToolInvocationHeaderLabel(displayInvocation, displayedState, workspaceRootPath)
  const diffCountSummary = renderDiffCountSummary(displayInvocation)
  const terminalToolName =
    displayInvocation.toolName === 'execute_terminal' || displayInvocation.toolName === 'get_terminal_output'
      ? displayInvocation.toolName
      : null
  const diffResultPresentation = displayInvocation.resultPresentation?.kind === 'file_diff' ? displayInvocation.resultPresentation : null
  const changeResultPresentation = displayInvocation.resultPresentation?.kind === 'change_diff' ? displayInvocation.resultPresentation : null
  const parsedStructuredResult = displayInvocation.resultContent ? parseStructuredToolResultContent(displayInvocation.resultContent) : null
  const rawResultBody =
    parsedStructuredResult?.body ??
    parsedStructuredResult?.metadata?.summary ??
    displayInvocation.resultContent ??
    ''
  const displayResultBody = getToolResultDisplayBody(displayInvocation.toolName, rawResultBody)
  const normalizedResultBody = useMemo(() => normalizeMarkdownText(displayResultBody), [displayResultBody])
  const shouldLimitResultHeight =
    terminalToolName === null && !isFileWriteTool(displayInvocation.toolName) && !isFileEditTool(displayInvocation.toolName)

  return (
    <div className="w-full">
      <button
        type="button"
        disabled={disableHeaderToggle}
        onClick={() => {
          if (disableHeaderToggle) {
            return
          }

          setIsOpen((currentValue) => !currentValue)
        }}
        className={[
          'group flex w-full min-w-0 items-center text-left text-sm text-muted-foreground transition-colors',
          disableHeaderToggle ? 'cursor-default opacity-90' : 'hover:text-foreground',
        ].join(' ')}
      >
        <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${isRunning ? 'thinking-shimmer' : ''}`}>
          <span className="min-w-0 truncate">{headerLabel}</span>
          {diffCountSummary ? <span className="inline-flex items-center gap-1">{diffCountSummary}</span> : null}
          {!disableHeaderToggle ? (
            <ChevronRight
              className={[
                'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100',
                isOpen ? 'rotate-90' : '',
              ].join(' ')}
            />
          ) : null}
        </span>
      </button>

      {isOpen && displayInvocation.resultContent ? (
        <div
          className={[
            'mt-1.5 w-full text-sm text-muted-foreground/90 [&>*:last-child]:mb-0',
            shouldLimitResultHeight ? 'max-h-80 overflow-y-auto pr-1' : '',
          ].join(' ')}
        >
          {diffResultPresentation ? (
            <DiffViewer
              contextLines={diffResultPresentation.contextLines}
              filePath={diffResultPresentation.fileName}
              isStreaming={displayInvocation.state === 'running'}
              newContent={diffResultPresentation.newContent}
              oldContent={diffResultPresentation.oldContent}
              startLineNumber={diffResultPresentation.startLineNumber}
              maxBodyHeightClassName="max-h-80"
            />
          ) : changeResultPresentation ? (
            <ChangeDiffResult parsedResult={changeResultPresentation} />
          ) : terminalToolName ? (
            <TerminalToolResult
              content={rawResultBody}
              isStreaming={displayInvocation.state === 'running'}
              toolName={terminalToolName}
            />
          ) : isKanbanTool(displayInvocation.toolName) ? (
            <KanbanToolResult
              invocation={displayInvocation}
              isStreaming={displayedState === 'running'}
            />
          ) : displayInvocation.toolName === 'web_search' ? (
            <WebToolResult
              invocation={displayInvocation}
              isStreaming={displayedState === 'running'}
            />
          ) : (
            <MarkdownRenderer
              content={normalizedResultBody}
              className="w-full opacity-85"
              isStreaming={displayInvocation.state === 'running'}
              preserveLineBreaks
            />
          )}
        </div>
      ) : null}

      {isOpen && invocation.decisionRequest ? (
        <div className="mt-1.5 max-h-80 w-full overflow-y-auto pr-1 text-sm text-muted-foreground/90">
          <ToolDecisionRequestCard
            onSubmit={(submission) => {
              if (!onToolDecisionSubmit) {
                return
              }

              setIsOpen(false)
              if (decisionRequestKey) {
                setSubmittedDecisionRequestKey(decisionRequestKey)
              }
              onToolDecisionSubmit(invocation, submission)
            }}
            request={invocation.decisionRequest}
          />
        </div>
      ) : null}
    </div>
  )
})
