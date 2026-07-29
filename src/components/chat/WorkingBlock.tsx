import { memo, useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface WorkingBlockProps {
  children: React.ReactNode
  startTime: number
  endTime: number
  isStreaming?: boolean
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

export const WorkingBlock = memo(function WorkingBlock({ children, startTime, endTime, isStreaming = false }: WorkingBlockProps) {
  const [isOpen, setIsOpen] = useState(isStreaming)
  const durationSeconds = Math.max((endTime - startTime) / 1000, 0)

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }, [isStreaming])

  const handleToggle = useCallback(() => {
    setIsOpen((currentValue) => !currentValue)
  }, [])

  return (
    <div>
      <WorkingBlockHeader
        isOpen={isOpen}
        durationSeconds={durationSeconds}
        isStreaming={isStreaming}
        onToggle={handleToggle}
      />
      {isOpen ? (
        <div className="mt-2.5 flex flex-col gap-2.5 opacity-90 pl-1.5">
          {children}
        </div>
      ) : null}
    </div>
  )
})

interface WorkingBlockHeaderProps {
  isOpen: boolean
  durationSeconds: number
  isStreaming?: boolean
  onToggle: () => void
}

const WorkingBlockHeader = memo(function WorkingBlockHeader({
  isOpen,
  durationSeconds,
  isStreaming = false,
  onToggle,
}: WorkingBlockHeaderProps) {
  const [isHovering, setIsHovering] = useState(false)
  
  const headerLabel = isStreaming
    ? 'Working...'
    : `Worked for ${formatDuration(durationSeconds)}`

  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      className="group flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className={isHovering ? 'text-foreground' : 'text-muted-foreground'}>
        {headerLabel}
      </span>
      <ChevronRight
        className={[
          'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
          isOpen ? 'rotate-90' : '',
        ].join(' ')}
      />
    </button>
  )
})
