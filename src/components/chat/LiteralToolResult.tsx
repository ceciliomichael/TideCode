import { memo } from 'react'

interface LiteralToolResultProps {
  content: string
}

/**
 * Displays machine-formatted tool output as literal source text.
 *
 * Read and grep results contain source lines, paths, and match formatting.
 * Rendering the complete body in a preformatted element keeps that content
 * literal instead of sending it through Markdown.
 */
export const LiteralToolResult = memo(function LiteralToolResult({ content }: LiteralToolResultProps) {
  return (
    <pre className="selectable-ui m-0 max-w-full overflow-x-auto whitespace-pre-wrap break-words font-[inherit] text-sm leading-[1.65] text-foreground">
      {content}
    </pre>
  )
})
