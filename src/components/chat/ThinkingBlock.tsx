import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { normalizeMarkdownText } from '../../lib/chatMessageContent'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useThinkingAutoScroll } from './useThinkingAutoScroll'

interface ThinkingBlockProps {
  content: string
  isComplete: boolean
  reasoningCompletedAt?: number
  startTime: number
}

function formatDuration(seconds: number): string {
  const normalizedSeconds = Math.max(seconds, 0.01)

  if (normalizedSeconds >= 60) {
    const minutes = Math.floor(normalizedSeconds / 60)
    const remainingSeconds = Math.round(normalizedSeconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${normalizedSeconds.toFixed(2)}s`
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, isComplete, reasoningCompletedAt, startTime }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isReasoningComplete = typeof reasoningCompletedAt === 'number'
  const normalizedContent = useMemo(() => normalizeMarkdownText(content), [content])
  const handleToggle = useCallback(() => {
    setIsOpen((currentValue) => !currentValue)
  }, [])

  useEffect(() => {
    if (isComplete || isReasoningComplete) {
      setIsOpen(false)
      return
    }

    if (!isComplete && !isReasoningComplete) {
      setIsOpen(true)
    }
  }, [isComplete, isReasoningComplete])

  return (
    <div>
      <ThinkingBlockHeader
        isComplete={isComplete}
        isOpen={isOpen}
        reasoningCompletedAt={reasoningCompletedAt}
        startTime={startTime}
        onToggle={handleToggle}
      />

      {isOpen ? <ThinkingBlockContent normalizedContent={normalizedContent} isComplete={isComplete} /> : null}
    </div>
  )
})

interface ThinkingBlockHeaderProps {
  isComplete: boolean
  isOpen: boolean
  reasoningCompletedAt?: number
  startTime: number
  onToggle: () => void
}

const ThinkingBlockHeader = memo(function ThinkingBlockHeader({
  isComplete,
  isOpen,
  reasoningCompletedAt,
  startTime,
  onToggle,
}: ThinkingBlockHeaderProps) {
  const [isHovering, setIsHovering] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)
  const frozenDurationRef = useRef<number | null>(null)
  const elapsedSecondsRef = useRef(0)
  const isReasoningComplete = typeof reasoningCompletedAt === 'number'
  const reasoningDurationSeconds =
    isReasoningComplete ? Math.max((reasoningCompletedAt - startTime) / 1000, 0) : null

  useEffect(() => {
    if (reasoningDurationSeconds !== null) {
      setElapsedSeconds(reasoningDurationSeconds)
      if (frozenDurationRef.current === null) {
        frozenDurationRef.current = reasoningDurationSeconds
      }

      elapsedSecondsRef.current = reasoningDurationSeconds
      return
    }

    if (!isComplete) {
      const intervalId = window.setInterval(() => {
        const nextElapsedSeconds = (Date.now() - startTime) / 1000
        elapsedSecondsRef.current = nextElapsedSeconds
        setElapsedSeconds(nextElapsedSeconds)
      }, 100)

      return () => {
        window.clearInterval(intervalId)
      }
    }

    if (frozenDurationRef.current === null) {
      frozenDurationRef.current = elapsedSecondsRef.current
    }
  }, [isComplete, reasoningDurationSeconds, startTime])

  const stableDuration = frozenDurationRef.current ?? reasoningDurationSeconds ?? elapsedSeconds
  const completedDuration = stableDuration ?? 0
  const headerLabel = isReasoningComplete
    ? `Thought for ${formatDuration(completedDuration)}`
    : isComplete
      ? stableDuration !== null
        ? `Thought for ${formatDuration(stableDuration)}`
        : 'Thought'
      : stableDuration !== null
        ? `Thinking for ${formatDuration(stableDuration)}`
        : 'Thinking'

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className="group flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <span
        className={[
          isComplete || isReasoningComplete
            ? isHovering
              ? 'text-foreground'
              : 'text-muted-foreground'
            : isHovering
              ? 'text-foreground'
              : 'thinking-shimmer',
        ].join(' ')}
      >
        {headerLabel}
      </span>
      <ChevronRight
        className={[
          'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100',
          isOpen ? 'rotate-90' : '',
        ].join(' ')}
      />
    </button>
  )
})

interface ThinkingBlockContentProps {
  normalizedContent: string
  isComplete: boolean
}

const ThinkingBlockContent = memo(function ThinkingBlockContent({ normalizedContent, isComplete }: ThinkingBlockContentProps) {
  const contentRef = useThinkingAutoScroll({ content: normalizedContent, isStreaming: !isComplete })

  return (
    <div
      ref={contentRef}
      className="mt-1.5 max-h-80 w-full min-w-0 overflow-y-auto pr-1 text-sm text-muted-foreground/90 [&>*:last-child]:mb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {normalizedContent.trim().length > 0 ? (
        <MarkdownRenderer content={normalizedContent} className="opacity-85" isStreaming={!isComplete} preserveLineBreaks />
      ) : (
        <p className="italic text-subtle-foreground">Thinking...</p>
      )}
    </div>
  )
})
