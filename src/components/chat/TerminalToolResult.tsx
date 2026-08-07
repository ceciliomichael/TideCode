interface TerminalToolResultProps {
  content: string
  isStreaming: boolean
  toolName: string
}

function getTerminalResultLabel(toolName: string) {
  if (toolName === 'execute_terminal') {
    return 'Terminal command'
  }

  if (toolName === 'interact_terminal') {
    return 'Terminal interaction'
  }

  if (toolName === 'read_terminal') {
    return 'Terminal output'
  }

  if (toolName === 'get_terminal_output') {
    return 'Terminal session output'
  }

  return 'Terminal output'
}

export function TerminalToolResult({ content, isStreaming, toolName }: TerminalToolResultProps) {
  const hasContent = content.trim().length > 0

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="px-3 py-2 text-[12px] font-medium text-muted-foreground">{getTerminalResultLabel(toolName)}</div>
      <div className="border-t border-border bg-surface-muted/55 p-3">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground/90">
          {hasContent ? content : isStreaming ? 'Awaiting terminal output...' : 'No terminal output.'}
        </pre>
      </div>
    </div>
  )
}
