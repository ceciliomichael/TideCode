export interface SourcePosition {
  line: number
  column: number
}

export interface CodeModeDiagnostic {
  kind: string
  message: string
  location?: SourcePosition
  suggestions?: string[]
}

export class CodeModeRuntimeError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly location?: SourcePosition,
    readonly suggestions: readonly string[] = [],
  ) {
    super(message)
    this.name = kind
  }
}

export function formatDiagnostic(diagnostic: CodeModeDiagnostic): string {
  const where = diagnostic.location
    ? ` (line ${diagnostic.location.line}, col ${diagnostic.location.column})`
    : ''
  return `${diagnostic.kind}: ${diagnostic.message}${where}`
}

export function toDiagnostic(error: unknown): CodeModeDiagnostic {
  if (error instanceof CodeModeRuntimeError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.location ? { location: error.location } : {}),
      ...(error.suggestions.length ? { suggestions: [...error.suggestions] } : {}),
    }
  }
  return {
    kind: 'ExecutionError',
    message: error instanceof Error ? error.message : String(error),
  }
}
