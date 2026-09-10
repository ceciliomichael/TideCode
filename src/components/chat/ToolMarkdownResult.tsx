import { memo } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface ToolMarkdownResultProps {
  content: string
  isOpen: boolean
  isStreaming: boolean
  shouldLimitHeight: boolean
}

export const ToolMarkdownResult = memo(function ToolMarkdownResult({
  content,
  isOpen,
  isStreaming,
  shouldLimitHeight,
}: ToolMarkdownResultProps) {
  const openClassName = shouldLimitHeight
    ? 'mt-1.5 max-h-80 overflow-y-auto pr-1'
    : 'mt-1.5'

  return (
    <div
      aria-hidden={isOpen ? undefined : true}
      data-tool-markdown-result={isOpen ? 'open' : 'premeasure'}
      className={[
        'w-full text-sm text-muted-foreground/90 [&>*:last-child]:mb-0',
        isOpen
          ? openClassName
          : 'pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden',
      ].join(' ')}
    >
      <MarkdownRenderer
        content={content}
        className="w-full opacity-85"
        isStreaming={isStreaming}
        preserveLineBreaks
      />
    </div>
  )
})
