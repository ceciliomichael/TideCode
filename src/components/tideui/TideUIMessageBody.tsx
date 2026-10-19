import { memo, useMemo } from 'react'
import { findIncompleteTideFenceStart, findTideFences } from '../../lib/tideui/segments'
import type { TideUIActions } from '../../lib/tideui/types'
import { MarkdownRenderer } from '../chat/MarkdownRenderer'
import { CodeBlock } from '../chat/CodeBlock'
import { TideUIBlock } from './TideUIBlock'
import { TideUIHtmlPreview } from './TideUIHtmlPreview'

interface TideUIMessageBodyProps {
  content: string
  isStreaming: boolean
  actions: TideUIActions
}

export const TideUIMessageBody = memo(function TideUIMessageBody({ content, isStreaming, actions }: TideUIMessageBodyProps) {
  const incompleteFenceStart = isStreaming ? findIncompleteTideFenceStart(content) : null
  const visibleContent = incompleteFenceStart === null ? content : content.slice(0, incompleteFenceStart)
  const fences = useMemo(() => findTideFences(visibleContent), [visibleContent])
  if (!fences.length) {
    return <div className="flex min-w-0 flex-col gap-2">
      <MarkdownRenderer key="markdown-0" content={visibleContent} className="text-left text-[15px]" isStreaming={isStreaming} preserveLineBreaks />
    </div>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const [index, fence] of fences.entries()) {
    if (fence.start > cursor) {
      parts.push(<MarkdownRenderer key={`markdown-${cursor}`} content={visibleContent.slice(cursor, fence.start)} className="text-left text-[15px]" isStreaming={isStreaming} preserveLineBreaks />)
    }
    if (!fence.closed && !isStreaming) {
      parts.push(<CodeBlock key={`pending-${fence.start}`} code={fence.source} language={fence.kind} isStreaming={isStreaming} />)
    } else if (fence.kind === 'tideui') {
      parts.push(<TideUIBlock
        key={`tideui-${fence.start}`}
        source={isStreaming && !fence.closed
          ? fence.source.slice(0, fence.source.lastIndexOf('\n') + 1)
          : fence.source}
        actions={actions}
        isStreaming={isStreaming}
        isBlockComplete={fence.closed}
      />)
    } else if (!fence.closed) {
      parts.push(<div className="tideui-caption" role="status" key={`pending-${fence.start}`}>Preparing preview…</div>)
    } else {
      parts.push(<TideUIHtmlPreview key={`html-${fence.start}`} source={fence.source} actions={actions} isStreaming={isStreaming} />)
    }
    cursor = fence.end
    if (index === fences.length - 1 && cursor < visibleContent.length) {
      parts.push(<MarkdownRenderer key={`markdown-${cursor}`} content={visibleContent.slice(cursor)} className="text-left text-[15px]" isStreaming={isStreaming} preserveLineBreaks />)
    }
  }
  return <div className="flex min-w-0 flex-col gap-2">{parts}</div>
})
