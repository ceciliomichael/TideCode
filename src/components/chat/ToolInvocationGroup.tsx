import { ChevronRight } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ToolInvocationTrace } from '../../types/chat'
import type { ToolInvocationDisplayEntry } from './toolInvocationPresentation'
import { ToolInvocationBlock } from './ToolInvocationBlock'
import type { ToolDecisionSubmission } from './ToolDecisionRequestCard'
import { buildToolInvocationGroupSummary } from './toolInvocationGrouping'

interface ToolInvocationGroupProps {
  entries: readonly ToolInvocationDisplayEntry[]
  hasAssistantText: boolean
  isConversationStreaming: boolean
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void
  workspaceRootPath?: string | null
}

export const ToolInvocationGroup = memo(function ToolInvocationGroup({
  entries,
  hasAssistantText,
  isConversationStreaming,
  onToolDecisionSubmit,
  workspaceRootPath = null,
}: ToolInvocationGroupProps) {
  const [isHovering, setIsHovering] = useState(false)
  const hasActiveInvocation = useMemo(
    () =>
      entries.some(
        (entry) => entry.invocation.state === 'running' || entry.invocation.decisionRequest !== undefined,
      ),
    [entries],
  )
  const isActiveGroup = !hasAssistantText && (hasActiveInvocation || isConversationStreaming)
  const [isOpen, setIsOpen] = useState(isActiveGroup)
  const previousIsActiveGroupRef = useRef(isActiveGroup)

  useEffect(() => {
    const wasActiveGroup = previousIsActiveGroupRef.current

    if (!wasActiveGroup && isActiveGroup) {
      setIsOpen(true)
    }

    if (wasActiveGroup && !isActiveGroup) {
      setIsOpen(false)
    }

    previousIsActiveGroupRef.current = isActiveGroup
  }, [isActiveGroup])

  const summaryLabel = useMemo(
    () => buildToolInvocationGroupSummary(entries.map((entry) => entry.invocation), isActiveGroup ? 'Exploring' : undefined),
    [entries, isActiveGroup],
  )

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        className="group flex w-full min-w-0 items-center text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={[
              'min-w-0 truncate',
              isActiveGroup
                ? isHovering
                  ? 'text-foreground'
                  : 'thinking-shimmer'
                : 'text-muted-foreground',
            ].join(' ')}
          >
            {summaryLabel}
          </span>
          <ChevronRight
            className={[
              'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100',
              isOpen ? 'rotate-90' : '',
            ].join(' ')}
          />
        </span>
      </button>

      {isOpen ? (
        <div className="mt-1.5 space-y-1.5 [&>*:last-child]:mb-0">
          {entries.map((entry) => (
            <ToolInvocationBlock
              key={entry.key}
              invocation={entry.invocation}
              onToolDecisionSubmit={onToolDecisionSubmit}
              workspaceRootPath={workspaceRootPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})
