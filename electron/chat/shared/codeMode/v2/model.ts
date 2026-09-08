export interface SourcePosition {
  line: number
  column: number
}

export interface SourceLocation {
  start: SourcePosition
  end: SourcePosition
}

export interface AstNode {
  type: string
  loc?: SourceLocation
  [key: string]: unknown
}

export interface ProgramNode extends AstNode {
  type: 'Program'
  body: AstNode[]
}

export type CodeModeDiagnosticKind =
  | 'ParseError'
  | 'UnsupportedSyntax'
  | 'ReferenceError'
  | 'TypeError'
  | 'UnknownTool'
  | 'InvalidToolArguments'
  | 'PermissionDenied'
  | 'ToolExecutionError'
  | 'StepLimitExceeded'
  | 'ToolCallLimitExceeded'
  | 'TimeoutExceeded'
  | 'OutputLimitExceeded'
  | 'Cancelled'
  | 'ExecutionError'

export interface CodeModeDiagnostic {
  kind: CodeModeDiagnosticKind
  message: string
  location?: SourcePosition
  suggestions?: string[]
}

export class CodeModeRuntimeError extends Error {
  readonly kind: CodeModeDiagnosticKind
  readonly node?: AstNode
  readonly suggestions: readonly string[]

  constructor(kind: CodeModeDiagnosticKind, message: string, node?: AstNode, suggestions: readonly string[] = []) {
    super(message)
    this.name = 'CodeModeRuntimeError'
    this.kind = kind
    this.node = node
    this.suggestions = suggestions
  }
}

export class ProgramThrow {
  constructor(readonly value: unknown) {}
}

export class ReturnSignal {
  constructor(readonly value: unknown) {}
}

export class BreakSignal {}
export class ContinueSignal {}

export class CodePromise {
  constructor(readonly promise: Promise<unknown>) {}
}

export interface Binding {
  mutable: boolean
  initialized: boolean
  value: unknown
}

export class Environment {
  private readonly bindings = new Map<string, Binding>()

  constructor(readonly parent?: Environment, readonly functionBoundary = false) {}

  declare(name: string, value: unknown, mutable: boolean, initialized = true): void {
    if (this.bindings.has(name)) {
      throw new CodeModeRuntimeError('ReferenceError', `Identifier '${name}' has already been declared.`)
    }
    this.bindings.set(name, { initialized, mutable, value })
  }

  declareVar(name: string, value: unknown): void {
    const scope = this.functionBoundary || !this.parent ? this : this.parent.nearestFunctionScope()
    const existing = scope.bindings.get(name)
    if (existing) {
      if (existing.mutable) existing.value = value
      return
    }
    scope.bindings.set(name, { initialized: true, mutable: true, value })
  }

  private nearestFunctionScope(): Environment {
    if (this.functionBoundary || !this.parent) return this
    return this.parent.nearestFunctionScope()
  }

  initialize(name: string, value: unknown): void {
    const own = this.bindings.get(name)
    if (!own) throw new CodeModeRuntimeError('ReferenceError', `Identifier '${name}' is not declared in this scope.`)
    own.value = value
    own.initialized = true
  }

  get(name: string, node?: AstNode): unknown {
    const binding = this.bindings.get(name)
    if (binding) {
      if (!binding.initialized) {
        throw new CodeModeRuntimeError('ReferenceError', `Cannot access '${name}' before initialization.`, node)
      }
      return binding.value
    }
    if (this.parent) return this.parent.get(name, node)
    throw new CodeModeRuntimeError('ReferenceError', `${name} is not defined.`, node)
  }

  set(name: string, value: unknown, node?: AstNode): unknown {
    const binding = this.bindings.get(name)
    if (binding) {
      if (!binding.initialized) {
        throw new CodeModeRuntimeError('ReferenceError', `Cannot access '${name}' before initialization.`, node)
      }
      if (!binding.mutable) {
        throw new CodeModeRuntimeError('TypeError', `Assignment to constant variable '${name}'.`, node)
      }
      binding.value = value
      return value
    }
    if (this.parent) return this.parent.set(name, value, node)
    throw new CodeModeRuntimeError('ReferenceError', `${name} is not defined.`, node)
  }
}

export class CodeFunction {
  constructor(
    readonly params: AstNode[],
    readonly body: AstNode,
    readonly closure: Environment,
    readonly isAsync: boolean,
    readonly expressionBody: boolean,
  ) {}
}

export class NativeFunction {
  constructor(
    readonly name: string,
    readonly invoke: (args: unknown[], node: AstNode) => Promise<unknown> | unknown,
  ) {}
}

export class IntrinsicReference {
  constructor(readonly receiver: unknown, readonly name: string) {}
}

export class GlobalNamespace {
  constructor(readonly name: 'Array' | 'Object' | 'Math' | 'JSON' | 'Promise' | 'console' | 'Number' | 'String') {}
}

export class ToolReference {
  constructor(readonly path: readonly string[]) {}
}

export class PayloadNamespace {
  private readonly values: Readonly<Record<string, string>>

  constructor(payloads: Readonly<Record<string, string>>) {
    this.values = Object.freeze(Object.assign(Object.create(null), payloads)) as Readonly<Record<string, string>>
  }

  get(name: string): string | undefined {
    return Object.hasOwn(this.values, name) ? this.values[name] : undefined
  }

  keys(): string[] {
    return Object.keys(this.values).sort()
  }

  entries(): Array<[string, string]> {
    return this.keys().map((key) => [key, this.values[key]!])
  }
}

export const BLOCKED_MEMBER_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

export const sourcePosition = (node?: AstNode): SourcePosition | undefined => {
  if (!node?.loc) return undefined
  return { line: Math.max(1, node.loc.start.line), column: Math.max(1, node.loc.start.column + 1) }
}

export const formatDiagnostic = (diagnostic: CodeModeDiagnostic): string => {
  const where = diagnostic.location
    ? ` (line ${diagnostic.location.line}, col ${diagnostic.location.column})`
    : ''
  return `${diagnostic.kind}: ${diagnostic.message}${where}`
}

export const toDiagnostic = (error: unknown): CodeModeDiagnostic => {
  if (error instanceof CodeModeRuntimeError) {
    const parseLocation = (error as CodeModeRuntimeError & { parseLocation?: SourcePosition }).parseLocation
    const location = sourcePosition(error.node) ?? parseLocation
    return {
      kind: error.kind,
      message: error.message,
      ...(location ? { location } : {}),
      ...(error.suggestions.length > 0 ? { suggestions: [...error.suggestions] } : {}),
    }
  }
  if (error instanceof ProgramThrow) {
    const value = error.value
    const message = typeof value === 'string'
      ? value
      : value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string'
        ? String((value as { message: string }).message)
        : String(value)
    return { kind: 'ExecutionError', message: `Uncaught: ${message}` }
  }
  if (error instanceof Error) return { kind: 'ExecutionError', message: error.message }
  return { kind: 'ExecutionError', message: String(error) }
}
