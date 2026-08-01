import { memo, useId } from 'react'
import { useResolvedDocumentTheme } from '../../../hooks/useResolvedDocumentTheme'
import { useMermaidRenderer } from './useMermaidRenderer'

interface MermaidDiagramProps {
  code: string
}

function RenderingIndicator() {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-4 text-sm text-muted-foreground">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: '300ms' }} />
      </div>
      <span>Rendering diagram...</span>
    </div>
  )
}

export const MermaidDiagram = memo(function MermaidDiagram({ code }: MermaidDiagramProps) {
  const theme = useResolvedDocumentTheme()
  const renderId = useId().replace(/:/g, '-')
  const { error, svg } = useMermaidRenderer({ code, renderId, theme })

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="rounded-[inherit] bg-background p-2">
        <div className="flex min-h-[220px] items-center justify-center overflow-hidden">
          {error ? (
            <div className="max-w-lg rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-center text-sm text-danger-foreground">
              <div className="mb-2 font-medium">Failed to render diagram</div>
              <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words text-left text-[12px] leading-5">
                {error}
              </pre>
            </div>
          ) : svg ? (
            <div
              id={renderId}
              className="mermaid-svg-container flex h-full w-full items-center justify-center overflow-hidden"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <RenderingIndicator />
          )}
        </div>
      </div>
    </div>
  )
})
