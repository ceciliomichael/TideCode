import { parse } from 'acorn'
import type { CodeModeExecutionLimits } from '../types'
import {
  BLOCKED_MEMBER_NAMES,
  BreakSignal,
  CodeFunction,
  CodeModeRuntimeError,
  CodePromise,
  ContinueSignal,
  Environment,
  GlobalNamespace,
  IntrinsicReference,
  NativeFunction,
  PayloadNamespace,
  ProgramThrow,
  ReturnSignal,
  ToolReference,
  type AstNode,
  type ProgramNode,
} from './model'
import { ToolRuntime } from './toolRuntime'
import { copyBoundaryValue, copyFinalValue, safeErrorValue, truthy } from './values'

const OPTIONAL_SHORT_CIRCUIT = Symbol('codemode.optional-short-circuit')

const SUPPORTED_NODE_TYPES = new Set([
  'Program',
  'ExpressionStatement',
  'EmptyStatement',
  'BlockStatement',
  'VariableDeclaration',
  'VariableDeclarator',
  'Identifier',
  'Literal',
  'ArrayExpression',
  'ObjectExpression',
  'Property',
  'SpreadElement',
  'RestElement',
  'AssignmentPattern',
  'ObjectPattern',
  'ArrayPattern',
  'MemberExpression',
  'ChainExpression',
  'CallExpression',
  'NewExpression',
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'AwaitExpression',
  'UnaryExpression',
  'BinaryExpression',
  'LogicalExpression',
  'ConditionalExpression',
  'AssignmentExpression',
  'UpdateExpression',
  'SequenceExpression',
  'TemplateLiteral',
  'TemplateElement',
  'IfStatement',
  'SwitchStatement',
  'SwitchCase',
  'ForStatement',
  'ForOfStatement',
  'ForInStatement',
  'WhileStatement',
  'DoWhileStatement',
  'BreakStatement',
  'ContinueStatement',
  'ReturnStatement',
  'ThrowStatement',
  'TryStatement',
  'CatchClause',
])

const BINARY_OPERATORS = new Set([
  '+', '-', '*', '/', '%', '**',
  '<', '<=', '>', '>=',
  '==', '!=', '===', '!==',
  '|', '&', '^', '<<', '>>', '>>>',
  'in',
])

const ASSIGNMENT_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '|=', '&=', '^=', '<<=', '>>=', '>>>=', '&&=', '||=', '??=',
])

const ARRAY_METHODS = new Set([
  'map', 'filter', 'find', 'findIndex', 'some', 'every', 'reduce', 'flatMap', 'forEach',
  'includes', 'join', 'slice', 'concat', 'indexOf', 'lastIndexOf', 'at', 'flat',
  'reverse', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'toSorted', 'toReversed',
])

const STRING_METHODS = new Set([
  'toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd', 'split', 'slice', 'substring',
  'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'replace', 'replaceAll', 'repeat',
  'padStart', 'padEnd', 'charAt', 'charCodeAt', 'codePointAt', 'at', 'concat', 'localeCompare', 'normalize',
])

const MATH_METHODS = new Set([
  'abs', 'ceil', 'floor', 'round', 'trunc', 'min', 'max', 'pow', 'sqrt', 'cbrt', 'sign',
  'log', 'log10', 'log2', 'exp', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'hypot', 'random',
])

const MATH_CONSTANTS: Record<string, number> = {
  E: Math.E,
  LN10: Math.LN10,
  LN2: Math.LN2,
  LOG10E: Math.LOG10E,
  LOG2E: Math.LOG2E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCanonicalIndexProperty(name: string): boolean {
  if (name === '0') return true
  if (name.length === 0 || name[0] === '0') return false
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code < 48 || code > 57) return false
  }
  return true
}

function asNode(value: unknown, context: string): AstNode {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new CodeModeRuntimeError('ExecutionError', `Invalid AST node while reading ${context}.`)
  }
  return value as AstNode
}

function optionalNode(node: AstNode, key: string): AstNode | undefined {
  const value = node[key]
  return value === null || value === undefined ? undefined : asNode(value, key)
}

function nodeArray(node: AstNode, key: string): AstNode[] {
  const value = node[key]
  if (!Array.isArray(value)) throw new CodeModeRuntimeError('ExecutionError', `Expected AST field ${key} to be an array.`, node)
  return value.filter((item): item is AstNode => item !== null).map((item) => asNode(item, key))
}

function stringField(node: AstNode, key: string): string {
  const value = node[key]
  if (typeof value !== 'string') throw new CodeModeRuntimeError('ExecutionError', `Expected AST field ${key} to be a string.`, node)
  return value
}

function booleanField(node: AstNode, key: string): boolean {
  return node[key] === true
}

function unsupported(node: AstNode, detail?: string): never {
  throw new CodeModeRuntimeError(
    'UnsupportedSyntax',
    detail ?? `Syntax '${node.type}' is not supported in Tidecode Code Mode.`,
    node,
    ['Use JavaScript-style orchestration with variables, loops, functions, await, try/catch, and tools.* capabilities.'],
  )
}

function validateNode(node: AstNode): void {
  if (!SUPPORTED_NODE_TYPES.has(node.type)) unsupported(node)
  if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && booleanField(node, 'generator')) {
    unsupported(node, 'Generator functions are not supported in Tidecode Code Mode.')
  }
  if (node.type === 'ForOfStatement' && booleanField(node, 'await')) {
    unsupported(node, 'for await...of is not supported in Tidecode Code Mode.')
  }
  if (node.type === 'UnaryExpression' && stringField(node, 'operator') === 'delete') {
    unsupported(node, 'delete is not supported in Tidecode Code Mode.')
  }
  if (node.type === 'BinaryExpression' && !BINARY_OPERATORS.has(stringField(node, 'operator'))) {
    unsupported(node, `Binary operator '${stringField(node, 'operator')}' is not supported in Tidecode Code Mode.`)
  }
  if (node.type === 'AssignmentExpression' && !ASSIGNMENT_OPERATORS.has(stringField(node, 'operator'))) {
    unsupported(node, `Assignment operator '${stringField(node, 'operator')}' is not supported in Tidecode Code Mode.`)
  }
  if (node.type === 'Literal') {
    if (node.regex !== undefined) unsupported(node, 'Regular expression literals are not supported in Tidecode Code Mode. Use string operations or tools.grep instead.')
    if (node.bigint !== undefined) unsupported(node, 'BigInt literals are not supported in Tidecode Code Mode.')
  }
  if (node.type === 'Property') {
    if (node.kind !== 'init' || booleanField(node, 'method')) unsupported(node, 'Object getters, setters, and method syntax are not supported. Use function-valued properties instead.')
  }
  if (node.type === 'MemberExpression' && !booleanField(node, 'computed')) {
    const property = asNode(node.property, 'property')
    if (property.type === 'Identifier' && BLOCKED_MEMBER_NAMES.has(stringField(property, 'name'))) {
      unsupported(node, `Property '${stringField(property, 'name')}' is not available in Tidecode Code Mode.`)
    }
  }
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    const callee = asNode(node.callee, 'callee')
    if (callee.type === 'Identifier') {
      const name = stringField(callee, 'name')
      if (name === 'eval' || name === 'Function') unsupported(node, `${name} is not available in Tidecode Code Mode.`)
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'type' || key === 'raw') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item) && typeof item.type === 'string') validateNode(item as AstNode)
      }
    } else if (isRecord(value) && typeof value.type === 'string') {
      validateNode(value as AstNode)
    }
  }
}

export function parseCodeModeProgram(source: string): ProgramNode {
  let parsed: unknown
  try {
    parsed = parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'script',
    })
  } catch (error) {
    const location = isRecord(error) && isRecord(error.loc)
      ? { line: Number(error.loc.line) || 1, column: (Number(error.loc.column) || 0) + 1 }
      : undefined
    const runtimeError = new CodeModeRuntimeError('ParseError', error instanceof Error ? error.message : String(error))
    if (location) {
      const locatedError = runtimeError as CodeModeRuntimeError & { parseLocation?: { line: number; column: number } }
      locatedError.parseLocation = location
    }
    throw runtimeError
  }
  if (!isRecord(parsed) || parsed.type !== 'Program' || !Array.isArray(parsed.body)) {
    throw new CodeModeRuntimeError('ParseError', 'Code Mode source did not parse as a program.')
  }
  const program = parsed as unknown as ProgramNode
  validateNode(program)
  return program
}

interface MemberLValue {
  target: Record<string, unknown> | unknown[]
  key: string | number
}

export interface InterpreterResult {
  value: unknown
  steps: number
}

export class CodeModeInterpreter {
  private steps = 0
  private callDepth = 0
  private readonly global = new Environment(undefined, true)

  constructor(
    private readonly tools: ToolRuntime,
    payloads: Readonly<Record<string, string>>,
    private readonly limits: CodeModeExecutionLimits,
    private readonly abortSignal: AbortSignal,
    private readonly deadline: number,
  ) {
    this.global.declare('payloads', new PayloadNamespace(payloads), false)
    this.installGlobals()
  }

  async execute(program: ProgramNode): Promise<InterpreterResult> {
    let value: unknown
    try {
      await this.executeStatements(program.body, this.global)
    } catch (signal) {
      if (signal instanceof ReturnSignal) value = await this.resolveAwaitable(signal.value)
      else throw signal
    }
    return { value: copyFinalValue(value), steps: this.steps }
  }

  private tick(node?: AstNode): void {
    this.steps += 1
    if (this.steps > this.limits.maxSteps) {
      throw new CodeModeRuntimeError('StepLimitExceeded', `Code Mode exceeded the ${this.limits.maxSteps}-step limit.`, node)
    }
    if (this.abortSignal.aborted) throw new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.', node)
    if (Date.now() > this.deadline) {
      throw new CodeModeRuntimeError('TimeoutExceeded', `Code Mode exceeded the ${this.limits.timeoutMs}ms timeout.`, node)
    }
  }

  private installGlobals(): void {
    this.global.declare('tools', this.tools.root(), false)
    for (const name of ['Array', 'Object', 'Math', 'JSON', 'Promise', 'console', 'Number', 'String'] as const) {
      this.global.declare(name, new GlobalNamespace(name), false)
    }
    this.global.declare('undefined', undefined, false)
    this.global.declare('NaN', Number.NaN, false)
    this.global.declare('Infinity', Number.POSITIVE_INFINITY, false)
    this.global.declare('Boolean', new NativeFunction('Boolean', (args) => Boolean(args[0])), false)
    this.global.declare('parseInt', new NativeFunction('parseInt', (args) => Number.parseInt(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))), false)
    this.global.declare('parseFloat', new NativeFunction('parseFloat', (args) => Number.parseFloat(String(args[0]))), false)
    for (const name of ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'] as const) {
      this.global.declare(name, new NativeFunction(name, (args) => Object.assign(Object.create(null), {
        name,
        message: args[0] === undefined ? '' : String(args[0]),
      })), false)
    }
  }

  private async executeStatements(statements: AstNode[], environment: Environment): Promise<void> {
    for (const statement of statements) {
      if (statement.type !== 'FunctionDeclaration') continue
      const id = asNode(statement.id, 'function id')
      if (id.type !== 'Identifier') unsupported(id)
      const fn = this.createFunction(statement, environment)
      const name = stringField(id, 'name')
      try {
        environment.declare(name, fn, true)
      } catch (error) {
        if (!(error instanceof CodeModeRuntimeError) || error.kind !== 'ReferenceError') throw error
      }
    }
    for (const statement of statements) {
      if (statement.type === 'FunctionDeclaration') continue
      await this.executeStatement(statement, environment)
    }
  }

  private async executeStatement(node: AstNode, environment: Environment): Promise<void> {
    this.tick(node)
    switch (node.type) {
      case 'EmptyStatement':
        return
      case 'ExpressionStatement': {
        const value = await this.evaluate(asNode(node.expression, 'expression'), environment)
        if (value instanceof CodePromise) await value.promise
        return
      }
      case 'BlockStatement': {
        const block = new Environment(environment)
        await this.executeStatements(nodeArray(node, 'body'), block)
        return
      }
      case 'VariableDeclaration': {
        const kind = stringField(node, 'kind')
        for (const declaration of nodeArray(node, 'declarations')) {
          const init = optionalNode(declaration, 'init')
          const value = init ? await this.evaluate(init, environment) : undefined
          await this.bindPattern(asNode(declaration.id, 'declaration id'), value, environment, kind)
        }
        return
      }
      case 'IfStatement': {
        const condition = await this.evaluate(asNode(node.test, 'test'), environment)
        if (truthy(condition)) await this.executeStatement(asNode(node.consequent, 'consequent'), environment)
        else {
          const alternate = optionalNode(node, 'alternate')
          if (alternate) await this.executeStatement(alternate, environment)
        }
        return
      }
      case 'SwitchStatement': {
        const discriminant = await this.evaluate(asNode(node.discriminant, 'discriminant'), environment)
        let matched = false
        try {
          for (const switchCase of nodeArray(node, 'cases')) {
            const test = optionalNode(switchCase, 'test')
            if (!matched && (!test || Object.is(discriminant, await this.evaluate(test, environment)))) matched = true
            if (!matched) continue
            await this.executeStatements(nodeArray(switchCase, 'consequent'), new Environment(environment))
          }
        } catch (signal) {
          if (signal instanceof BreakSignal) return
          throw signal
        }
        return
      }
      case 'WhileStatement':
        while (truthy(await this.evaluate(asNode(node.test, 'test'), environment))) {
          this.tick(node)
          try {
            await this.executeStatement(asNode(node.body, 'body'), environment)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (signal instanceof ContinueSignal) continue
            throw signal
          }
        }
        return
      case 'DoWhileStatement':
        do {
          this.tick(node)
          try {
            await this.executeStatement(asNode(node.body, 'body'), environment)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (!(signal instanceof ContinueSignal)) throw signal
          }
        } while (truthy(await this.evaluate(asNode(node.test, 'test'), environment)))
        return
      case 'ForStatement': {
        const loop = new Environment(environment)
        const init = optionalNode(node, 'init')
        if (init) {
          if (init.type === 'VariableDeclaration') await this.executeStatement(init, loop)
          else await this.evaluate(init, loop)
        }
        for (;;) {
          this.tick(node)
          const test = optionalNode(node, 'test')
          if (test && !truthy(await this.evaluate(test, loop))) break
          try {
            await this.executeStatement(asNode(node.body, 'body'), loop)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (!(signal instanceof ContinueSignal)) throw signal
          }
          const update = optionalNode(node, 'update')
          if (update) await this.evaluate(update, loop)
        }
        return
      }
      case 'ForOfStatement':
      case 'ForInStatement': {
        const right = await this.evaluate(asNode(node.right, 'right'), environment)
        const values = node.type === 'ForOfStatement'
          ? this.iterableValues(right, node)
          : this.enumerableKeys(right, node)
        for (const value of values) {
          this.tick(node)
          const iteration = new Environment(environment)
          await this.bindLoopLeft(asNode(node.left, 'left'), value, iteration)
          try {
            await this.executeStatement(asNode(node.body, 'body'), iteration)
          } catch (signal) {
            if (signal instanceof BreakSignal) break
            if (signal instanceof ContinueSignal) continue
            throw signal
          }
        }
        return
      }
      case 'BreakStatement':
        throw new BreakSignal()
      case 'ContinueStatement':
        throw new ContinueSignal()
      case 'ReturnStatement': {
        const argument = optionalNode(node, 'argument')
        throw new ReturnSignal(argument ? await this.evaluate(argument, environment) : undefined)
      }
      case 'ThrowStatement':
        throw new ProgramThrow(await this.evaluate(asNode(node.argument, 'argument'), environment))
      case 'TryStatement': {
        try {
          await this.executeStatement(asNode(node.block, 'block'), environment)
        } catch (error) {
          if (error instanceof ReturnSignal || error instanceof BreakSignal || error instanceof ContinueSignal) throw error
          const handler = optionalNode(node, 'handler')
          if (!handler) throw error
          const catchEnvironment = new Environment(environment)
          const parameter = optionalNode(handler, 'param')
          if (parameter) {
            const caught = error instanceof ProgramThrow ? error.value : safeErrorValue(error)
            await this.bindPattern(parameter, caught, catchEnvironment, 'let')
          }
          await this.executeStatement(asNode(handler.body, 'catch body'), catchEnvironment)
        } finally {
          const finalizer = optionalNode(node, 'finalizer')
          if (finalizer) await this.executeStatement(finalizer, environment)
        }
        return
      }
      default:
        unsupported(node)
    }
  }

  private iterableValues(value: unknown, node: AstNode): unknown[] {
    if (Array.isArray(value)) return [...value]
    if (typeof value === 'string') return Array.from(value)
    throw new CodeModeRuntimeError('TypeError', 'for...of expects an array or string in Tidecode Code Mode.', node)
  }

  private enumerableKeys(value: unknown, node: AstNode): string[] {
    if (value instanceof ToolReference) return this.tools.keys(value)
    if (value instanceof PayloadNamespace) return value.keys()
    if (Array.isArray(value)) return Object.keys(value)
    if (value && typeof value === 'object') return Object.keys(value)
    throw new CodeModeRuntimeError('TypeError', 'for...in expects a data object, array, or tools namespace.', node)
  }

  private async bindLoopLeft(left: AstNode, value: unknown, environment: Environment): Promise<void> {
    if (left.type === 'VariableDeclaration') {
      const declarations = nodeArray(left, 'declarations')
      if (declarations.length !== 1) unsupported(left, 'Loop declarations must contain exactly one binding.')
      await this.bindPattern(asNode(declarations[0]!.id, 'loop binding'), value, environment, stringField(left, 'kind'))
      return
    }
    await this.assignPattern(left, value, environment)
  }

  private async bindPattern(pattern: AstNode, value: unknown, environment: Environment, kind: string): Promise<void> {
    switch (pattern.type) {
      case 'Identifier': {
        const name = stringField(pattern, 'name')
        if (kind === 'var') environment.declareVar(name, value)
        else environment.declare(name, value, kind !== 'const')
        return
      }
      case 'AssignmentPattern': {
        const chosen = value === undefined ? await this.evaluate(asNode(pattern.right, 'default value'), environment) : value
        await this.bindPattern(asNode(pattern.left, 'binding'), chosen, environment, kind)
        return
      }
      case 'ArrayPattern': {
        if (!Array.isArray(value)) throw new CodeModeRuntimeError('TypeError', 'Array destructuring expects an array.', pattern)
        const elements = pattern.elements
        if (!Array.isArray(elements)) unsupported(pattern)
        for (let index = 0; index < elements.length; index += 1) {
          const raw = elements[index]
          if (raw === null) continue
          const item = asNode(raw, 'array pattern element')
          if (item.type === 'RestElement') {
            await this.bindPattern(asNode(item.argument, 'rest binding'), value.slice(index), environment, kind)
            break
          }
          await this.bindPattern(item, value[index], environment, kind)
        }
        return
      }
      case 'ObjectPattern': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new CodeModeRuntimeError('TypeError', 'Object destructuring expects a data object.', pattern)
        }
        const record = value as Record<string, unknown>
        const used = new Set<string>()
        for (const property of nodeArray(pattern, 'properties')) {
          if (property.type === 'RestElement') {
            const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !used.has(key)))
            await this.bindPattern(asNode(property.argument, 'rest binding'), rest, environment, kind)
            continue
          }
          const key = await this.propertyKey(property, environment)
          used.add(String(key))
          await this.bindPattern(asNode(property.value, 'property binding'), record[String(key)], environment, kind)
        }
        return
      }
      default:
        unsupported(pattern, `Unsupported binding pattern '${pattern.type}'.`)
    }
  }

  private async assignPattern(pattern: AstNode, value: unknown, environment: Environment): Promise<void> {
    switch (pattern.type) {
      case 'Identifier':
        environment.set(stringField(pattern, 'name'), value, pattern)
        return
      case 'MemberExpression': {
        const reference = await this.memberLValue(pattern, environment)
        reference.target[reference.key as keyof typeof reference.target] = value as never
        return
      }
      case 'AssignmentPattern': {
        const chosen = value === undefined ? await this.evaluate(asNode(pattern.right, 'default value'), environment) : value
        await this.assignPattern(asNode(pattern.left, 'assignment target'), chosen, environment)
        return
      }
      case 'ArrayPattern': {
        if (!Array.isArray(value)) throw new CodeModeRuntimeError('TypeError', 'Array assignment destructuring expects an array.', pattern)
        const elements = pattern.elements
        if (!Array.isArray(elements)) unsupported(pattern)
        for (let index = 0; index < elements.length; index += 1) {
          const raw = elements[index]
          if (raw === null) continue
          const item = asNode(raw, 'array assignment element')
          if (item.type === 'RestElement') {
            await this.assignPattern(asNode(item.argument, 'rest assignment'), value.slice(index), environment)
            break
          }
          await this.assignPattern(item, value[index], environment)
        }
        return
      }
      case 'ObjectPattern': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new CodeModeRuntimeError('TypeError', 'Object assignment destructuring expects a data object.', pattern)
        }
        const record = value as Record<string, unknown>
        const used = new Set<string>()
        for (const property of nodeArray(pattern, 'properties')) {
          if (property.type === 'RestElement') {
            const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !used.has(key)))
            await this.assignPattern(asNode(property.argument, 'rest assignment'), rest, environment)
            continue
          }
          const key = await this.propertyKey(property, environment)
          used.add(String(key))
          await this.assignPattern(asNode(property.value, 'property assignment'), record[String(key)], environment)
        }
        return
      }
      default:
        unsupported(pattern, `Unsupported assignment target '${pattern.type}'.`)
    }
  }

  private async propertyKey(property: AstNode, environment: Environment): Promise<string | number> {
    const keyNode = asNode(property.key, 'property key')
    let key: unknown
    if (booleanField(property, 'computed')) key = await this.evaluate(keyNode, environment)
    else if (keyNode.type === 'Identifier') key = stringField(keyNode, 'name')
    else if (keyNode.type === 'Literal') key = keyNode.value
    else unsupported(keyNode, 'Object property keys must be identifiers, literals, or computed data values.')
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new CodeModeRuntimeError('TypeError', 'Property keys must resolve to strings or numbers.', keyNode)
    }
    if (BLOCKED_MEMBER_NAMES.has(String(key))) {
      throw new CodeModeRuntimeError('TypeError', `Property '${String(key)}' is not available in Tidecode Code Mode.`, keyNode)
    }
    return key
  }

  private async evaluate(node: AstNode, environment: Environment): Promise<unknown> {
    this.tick(node)
    switch (node.type) {
      case 'Identifier':
        return environment.get(stringField(node, 'name'), node)
      case 'Literal':
        return node.value
      case 'ArrayExpression': {
        const raw = node.elements
        if (!Array.isArray(raw)) unsupported(node)
        const out: unknown[] = []
        for (const element of raw) {
          if (element === null) {
            out.length += 1
            continue
          }
          const item = asNode(element, 'array element')
          if (item.type === 'SpreadElement') {
            const spread = await this.evaluate(asNode(item.argument, 'spread argument'), environment)
            if (Array.isArray(spread)) out.push(...spread)
            else if (typeof spread === 'string') out.push(...Array.from(spread))
            else throw new CodeModeRuntimeError('TypeError', 'Array spread expects an array or string.', item)
          } else {
            out.push(await this.evaluate(item, environment))
          }
        }
        return out
      }
      case 'ObjectExpression': {
        const out: Record<string, unknown> = Object.create(null)
        for (const property of nodeArray(node, 'properties')) {
          if (property.type === 'SpreadElement') {
            const spread = copyBoundaryValue(await this.evaluate(asNode(property.argument, 'spread argument'), environment), 'Object spread', property)
            if (!spread || typeof spread !== 'object' || Array.isArray(spread)) {
              throw new CodeModeRuntimeError('TypeError', 'Object spread expects a data object.', property)
            }
            for (const [key, value] of Object.entries(spread)) {
              if (BLOCKED_MEMBER_NAMES.has(key)) throw new CodeModeRuntimeError('TypeError', `Property '${key}' is blocked.`, property)
              out[key] = value
            }
            continue
          }
          const key = await this.propertyKey(property, environment)
          out[String(key)] = await this.evaluate(asNode(property.value, 'property value'), environment)
        }
        return out
      }
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        return this.createFunction(node, environment)
      case 'ChainExpression': {
        const value = await this.evaluate(asNode(node.expression, 'chain expression'), environment)
        return value === OPTIONAL_SHORT_CIRCUIT ? undefined : value
      }
      case 'MemberExpression':
        return this.evaluateMember(node, environment)
      case 'CallExpression':
        return this.evaluateCall(node, environment)
      case 'NewExpression': {
        const callee = await this.evaluate(asNode(node.callee, 'callee'), environment)
        if (!(callee instanceof NativeFunction) || !['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError'].includes(callee.name)) {
          unsupported(node, 'Only standard Error values may be constructed with new in Tidecode Code Mode.')
        }
        const args = await this.evaluateArguments(node, environment)
        return callee.invoke(args, node)
      }
      case 'AwaitExpression':
        return this.resolveAwaitable(await this.evaluate(asNode(node.argument, 'await argument'), environment))
      case 'UnaryExpression':
        return this.evaluateUnary(node, environment)
      case 'BinaryExpression':
        return this.evaluateBinary(node, environment)
      case 'LogicalExpression':
        return this.evaluateLogical(node, environment)
      case 'ConditionalExpression':
        return truthy(await this.evaluate(asNode(node.test, 'test'), environment))
          ? this.evaluate(asNode(node.consequent, 'consequent'), environment)
          : this.evaluate(asNode(node.alternate, 'alternate'), environment)
      case 'AssignmentExpression':
        return this.evaluateAssignment(node, environment)
      case 'UpdateExpression':
        return this.evaluateUpdate(node, environment)
      case 'SequenceExpression': {
        let value: unknown
        for (const expression of nodeArray(node, 'expressions')) value = await this.evaluate(expression, environment)
        return value
      }
      case 'TemplateLiteral': {
        const quasis = nodeArray(node, 'quasis')
        const expressions = nodeArray(node, 'expressions')
        let out = ''
        for (let index = 0; index < quasis.length; index += 1) {
          const quasi = quasis[index]!
          const quasiValue = quasi.value
          out += isRecord(quasiValue) && typeof quasiValue.cooked === 'string'
            ? quasiValue.cooked
            : isRecord(quasiValue) && typeof quasiValue.raw === 'string'
              ? quasiValue.raw
              : ''
          if (index < expressions.length) out += this.coerceString(await this.evaluate(expressions[index]!, environment), expressions[index]!)
        }
        return out
      }
      default:
        unsupported(node)
    }
  }

  private createFunction(node: AstNode, environment: Environment): CodeFunction {
    const body = asNode(node.body, 'function body')
    return new CodeFunction(
      nodeArray(node, 'params'),
      body,
      environment,
      booleanField(node, 'async'),
      body.type !== 'BlockStatement',
    )
  }

  private async invokeFunction(fn: CodeFunction, args: unknown[], node: AstNode): Promise<unknown> {
    this.callDepth += 1
    if (this.callDepth > this.limits.maxCallDepth) {
      this.callDepth -= 1
      throw new CodeModeRuntimeError('StepLimitExceeded', `Code Mode exceeded the ${this.limits.maxCallDepth}-call-depth limit.`, node)
    }
    const scope = new Environment(fn.closure, true)
    try {
      let argumentIndex = 0
      for (const parameter of fn.params) {
        if (parameter.type === 'RestElement') {
          await this.bindPattern(asNode(parameter.argument, 'rest parameter'), args.slice(argumentIndex), scope, 'let')
          argumentIndex = args.length
          continue
        }
        await this.bindPattern(parameter, args[argumentIndex], scope, 'let')
        argumentIndex += 1
      }
      if (fn.expressionBody) return this.evaluate(fn.body, scope)
      try {
        await this.executeStatement(fn.body, scope)
        return undefined
      } catch (signal) {
        if (signal instanceof ReturnSignal) return signal.value
        throw signal
      }
    } finally {
      this.callDepth -= 1
    }
  }

  private async evaluateMember(node: AstNode, environment: Environment): Promise<unknown> {
    const receiver = await this.evaluate(asNode(node.object, 'member object'), environment)
    if (receiver === OPTIONAL_SHORT_CIRCUIT) return OPTIONAL_SHORT_CIRCUIT
    if ((receiver === null || receiver === undefined) && booleanField(node, 'optional')) return OPTIONAL_SHORT_CIRCUIT
    if (receiver === null || receiver === undefined) {
      throw new CodeModeRuntimeError('TypeError', 'Cannot read properties of null or undefined.', node)
    }
    const key = await this.memberKey(node, environment)
    return this.memberValue(receiver, key, node)
  }

  private async memberKey(node: AstNode, environment: Environment): Promise<string | number> {
    const property = asNode(node.property, 'member property')
    const key = booleanField(node, 'computed')
      ? await this.evaluate(property, environment)
      : property.type === 'Identifier'
        ? stringField(property, 'name')
        : property.value
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new CodeModeRuntimeError('TypeError', 'Member keys must resolve to strings or numbers.', property)
    }
    if (BLOCKED_MEMBER_NAMES.has(String(key))) {
      throw new CodeModeRuntimeError('TypeError', `Property '${String(key)}' is not available in Tidecode Code Mode.`, property)
    }
    return key
  }

  private memberValue(receiver: unknown, key: string | number, node: AstNode): unknown {
    const name = String(key)
    if (receiver instanceof ToolReference) return this.tools.member(receiver, name, node)
    if (receiver instanceof PayloadNamespace) return receiver.get(name)
    if (receiver instanceof CodePromise) {
      throw new CodeModeRuntimeError('TypeError', 'Promise chaining is not supported. Await the promise first.', node)
    }
    if (receiver instanceof GlobalNamespace) {
      if (receiver.name === 'Math' && Object.hasOwn(MATH_CONSTANTS, name)) return MATH_CONSTANTS[name]
      return new IntrinsicReference(receiver, name)
    }
    if (Array.isArray(receiver)) {
      if (name === 'length') return receiver.length
      if (isCanonicalIndexProperty(name)) return receiver[Number(name)]
      if (ARRAY_METHODS.has(name)) return new IntrinsicReference(receiver, name)
      throw new CodeModeRuntimeError('TypeError', `Array method/property '${name}' is not available in Tidecode Code Mode.`, node)
    }
    if (typeof receiver === 'string') {
      if (name === 'length') return receiver.length
      if (isCanonicalIndexProperty(name)) return receiver[Number(name)]
      if (STRING_METHODS.has(name)) return new IntrinsicReference(receiver, name)
      throw new CodeModeRuntimeError('TypeError', `String method/property '${name}' is not available in Tidecode Code Mode.`, node)
    }
    if (receiver && typeof receiver === 'object') {
      const record = receiver as Record<string, unknown>
      return Object.hasOwn(record, name) ? record[name] : undefined
    }
    throw new CodeModeRuntimeError('TypeError', `Cannot read property '${name}' from this value.`, node)
  }

  private async evaluateCall(node: AstNode, environment: Environment): Promise<unknown> {
    const callee = await this.evaluate(asNode(node.callee, 'callee'), environment)
    if (callee === OPTIONAL_SHORT_CIRCUIT) return OPTIONAL_SHORT_CIRCUIT
    if ((callee === null || callee === undefined) && booleanField(node, 'optional')) return OPTIONAL_SHORT_CIRCUIT
    const args = await this.evaluateArguments(node, environment)
    if (callee instanceof ToolReference) return this.tools.call(callee, args, node)
    if (callee instanceof CodeFunction) {
      const result = this.invokeFunction(callee, args, node)
      return callee.isAsync ? new CodePromise(result) : result
    }
    if (callee instanceof NativeFunction) return callee.invoke(args, node)
    if (callee instanceof IntrinsicReference) return this.invokeIntrinsic(callee, args, node)
    throw new CodeModeRuntimeError('TypeError', 'Attempted to call a value that is not callable in Tidecode Code Mode.', node)
  }

  private async evaluateArguments(node: AstNode, environment: Environment): Promise<unknown[]> {
    const raw = node.arguments
    if (!Array.isArray(raw)) unsupported(node)
    const args: unknown[] = []
    for (const item of raw) {
      const argument = asNode(item, 'call argument')
      if (argument.type === 'SpreadElement') {
        const value = await this.evaluate(asNode(argument.argument, 'spread argument'), environment)
        if (!Array.isArray(value)) throw new CodeModeRuntimeError('TypeError', 'Call spread expects an array.', argument)
        args.push(...value)
      } else {
        args.push(await this.evaluate(argument, environment))
      }
    }
    return args
  }

  private async resolveAwaitable(value: unknown): Promise<unknown> {
    return value instanceof CodePromise ? value.promise : value
  }

  private async evaluateUnary(node: AstNode, environment: Environment): Promise<unknown> {
    const operator = stringField(node, 'operator')
    const argumentNode = asNode(node.argument, 'argument')
    if (operator === 'typeof' && argumentNode.type === 'Identifier') {
      try {
        return this.typeofValue(environment.get(stringField(argumentNode, 'name'), argumentNode))
      } catch (error) {
        if (error instanceof CodeModeRuntimeError && error.kind === 'ReferenceError') return 'undefined'
        throw error
      }
    }
    const value = await this.evaluate(argumentNode, environment)
    switch (operator) {
      case '!': return !truthy(value)
      case '+': return Number(this.dataOperand(value, node))
      case '-': return -Number(this.dataOperand(value, node))
      case '~': return ~Number(this.dataOperand(value, node))
      case 'typeof': return this.typeofValue(value)
      case 'void': return undefined
      default: unsupported(node, `Unary operator '${operator}' is not supported.`)
    }
  }

  private typeofValue(value: unknown): string {
    if (value instanceof CodeFunction || value instanceof NativeFunction || value instanceof IntrinsicReference) return 'function'
    if (value instanceof ToolReference) return value.path.length === 0 ? 'object' : 'function'
    if (value instanceof PayloadNamespace) return 'object'
    if (value instanceof GlobalNamespace) return ['Math', 'JSON', 'console'].includes(value.name) ? 'object' : 'function'
    if (value instanceof CodePromise) return 'object'
    return typeof value
  }

  private dataOperand(value: unknown, node: AstNode): unknown {
    if (
      value instanceof CodePromise ||
      value instanceof CodeFunction ||
      value instanceof NativeFunction ||
      value instanceof IntrinsicReference ||
      value instanceof ToolReference ||
      value instanceof GlobalNamespace ||
      value instanceof PayloadNamespace
    ) {
      throw new CodeModeRuntimeError('TypeError', 'This operation requires a data value. Await tool calls before using their results.', node)
    }
    return value
  }

  private async evaluateBinary(node: AstNode, environment: Environment): Promise<unknown> {
    const left = this.dataOperand(await this.evaluate(asNode(node.left, 'left'), environment), node)
    const right = this.dataOperand(await this.evaluate(asNode(node.right, 'right'), environment), node)
    const operator = stringField(node, 'operator')
    switch (operator) {
      case '+': return (left as string) + (right as string)
      case '-': return Number(left) - Number(right)
      case '*': return Number(left) * Number(right)
      case '/': return Number(left) / Number(right)
      case '%': return Number(left) % Number(right)
      case '**': return Number(left) ** Number(right)
      case '<': return (left as string) < (right as string)
      case '<=': return (left as string) <= (right as string)
      case '>': return (left as string) > (right as string)
      case '>=': return (left as string) >= (right as string)
      case '==': return left == right
      case '!=': return left != right
      case '===': return left === right
      case '!==': return left !== right
      case '|': return Number(left) | Number(right)
      case '&': return Number(left) & Number(right)
      case '^': return Number(left) ^ Number(right)
      case '<<': return Number(left) << Number(right)
      case '>>': return Number(left) >> Number(right)
      case '>>>': return Number(left) >>> Number(right)
      case 'in': {
        const key = String(left)
        if (right instanceof ToolReference) return this.tools.keys(right).includes(key)
        if (right instanceof PayloadNamespace) return right.keys().includes(key)
        if (right && typeof right === 'object') return key in right
        throw new CodeModeRuntimeError('TypeError', "Right-hand side of 'in' must be an object.", node)
      }
      default: unsupported(node, `Binary operator '${operator}' is not supported.`)
    }
  }

  private async evaluateLogical(node: AstNode, environment: Environment): Promise<unknown> {
    const left = await this.evaluate(asNode(node.left, 'left'), environment)
    switch (stringField(node, 'operator')) {
      case '&&': return truthy(left) ? this.evaluate(asNode(node.right, 'right'), environment) : left
      case '||': return truthy(left) ? left : this.evaluate(asNode(node.right, 'right'), environment)
      case '??': return left === null || left === undefined ? this.evaluate(asNode(node.right, 'right'), environment) : left
      default: unsupported(node)
    }
  }

  private async evaluateAssignment(node: AstNode, environment: Environment): Promise<unknown> {
    const left = asNode(node.left, 'assignment target')
    const operator = stringField(node, 'operator')
    if (operator === '=' && ['ObjectPattern', 'ArrayPattern'].includes(left.type)) {
      const value = await this.evaluate(asNode(node.right, 'right'), environment)
      await this.assignPattern(left, value, environment)
      return value
    }
    const current = await this.readLValue(left, environment)
    if (operator === '&&=' && !truthy(current)) return current
    if (operator === '||=' && truthy(current)) return current
    if (operator === '??=' && current !== null && current !== undefined) return current
    const right = await this.evaluate(asNode(node.right, 'right'), environment)
    const value = operator === '=' || ['&&=', '||=', '??='].includes(operator)
      ? right
      : this.applyCompound(operator, current, right, node)
    await this.writeLValue(left, value, environment)
    return value
  }

  private applyCompound(operator: string, left: unknown, right: unknown, node: AstNode): unknown {
    const a = this.dataOperand(left, node)
    const b = this.dataOperand(right, node)
    switch (operator) {
      case '+=': return (a as string) + (b as string)
      case '-=': return Number(a) - Number(b)
      case '*=': return Number(a) * Number(b)
      case '/=': return Number(a) / Number(b)
      case '%=': return Number(a) % Number(b)
      case '**=': return Number(a) ** Number(b)
      case '|=': return Number(a) | Number(b)
      case '&=': return Number(a) & Number(b)
      case '^=': return Number(a) ^ Number(b)
      case '<<=': return Number(a) << Number(b)
      case '>>=': return Number(a) >> Number(b)
      case '>>>=': return Number(a) >>> Number(b)
      default: unsupported(node)
    }
  }

  private async evaluateUpdate(node: AstNode, environment: Environment): Promise<unknown> {
    const argument = asNode(node.argument, 'update target')
    const current = Number(this.dataOperand(await this.readLValue(argument, environment), node))
    const updated = stringField(node, 'operator') === '++' ? current + 1 : current - 1
    await this.writeLValue(argument, updated, environment)
    return booleanField(node, 'prefix') ? updated : current
  }

  private async readLValue(node: AstNode, environment: Environment): Promise<unknown> {
    if (node.type === 'Identifier') return environment.get(stringField(node, 'name'), node)
    if (node.type === 'MemberExpression') {
      const reference = await this.memberLValue(node, environment)
      return reference.target[reference.key as keyof typeof reference.target]
    }
    unsupported(node, `Unsupported assignment target '${node.type}'.`)
  }

  private async writeLValue(node: AstNode, value: unknown, environment: Environment): Promise<void> {
    if (node.type === 'Identifier') {
      environment.set(stringField(node, 'name'), value, node)
      return
    }
    if (node.type === 'MemberExpression') {
      const reference = await this.memberLValue(node, environment)
      reference.target[reference.key as keyof typeof reference.target] = value as never
      return
    }
    unsupported(node, `Unsupported assignment target '${node.type}'.`)
  }

  private async memberLValue(node: AstNode, environment: Environment): Promise<MemberLValue> {
    const receiver = await this.evaluate(asNode(node.object, 'member object'), environment)
    if (receiver instanceof ToolReference || receiver instanceof GlobalNamespace || receiver instanceof CodePromise || receiver instanceof PayloadNamespace) {
      throw new CodeModeRuntimeError('TypeError', 'This Code Mode value is read-only.', node)
    }
    if (!Array.isArray(receiver) && (!receiver || typeof receiver !== 'object')) {
      throw new CodeModeRuntimeError('TypeError', 'Member assignment expects an array or data object.', node)
    }
    const key = await this.memberKey(node, environment)
    return { target: receiver as Record<string, unknown> | unknown[], key }
  }

  private async invokeIntrinsic(reference: IntrinsicReference, args: unknown[], node: AstNode): Promise<unknown> {
    if (reference.receiver instanceof GlobalNamespace) {
      return this.invokeGlobal(reference.receiver.name, reference.name, args, node)
    }
    if (Array.isArray(reference.receiver)) {
      return this.invokeArray(reference.receiver, reference.name, args, node)
    }
    if (typeof reference.receiver === 'string') {
      return this.invokeString(reference.receiver, reference.name, args, node)
    }
    throw new CodeModeRuntimeError('TypeError', `Intrinsic '${reference.name}' is not callable for this value.`, node)
  }

  private async invokeGlobal(
    namespace: GlobalNamespace['name'],
    name: string,
    args: unknown[],
    node: AstNode,
  ): Promise<unknown> {
    switch (namespace) {
      case 'Array':
        if (name === 'isArray') return Array.isArray(args[0])
        if (name === 'of') return [...args]
        if (name === 'from') {
          const input = args[0]
          let values: unknown[]
          if (Array.isArray(input)) values = [...input]
          else if (typeof input === 'string') values = Array.from(input)
          else if (input && typeof input === 'object' && Number.isInteger((input as Record<string, unknown>).length)) {
            const length = Math.max(0, Math.min(10_000, Number((input as Record<string, unknown>).length)))
            values = Array.from({ length }, (_, index) => (input as Record<string, unknown>)[String(index)])
          } else {
            throw new CodeModeRuntimeError('TypeError', 'Array.from expects an array, string, or bounded array-like object.', node)
          }
          const mapper = args[1]
          if (mapper === undefined) return values
          if (!(mapper instanceof CodeFunction) && !(mapper instanceof NativeFunction)) {
            throw new CodeModeRuntimeError('TypeError', 'Array.from mapper must be a Code Mode function.', node)
          }
          const mapped: unknown[] = []
          for (let index = 0; index < values.length; index += 1) {
            mapped.push(await this.invokeArrayCallback(mapper, [values[index], index], node, false))
          }
          return mapped
        }
        break
      case 'Object':
        return this.invokeObject(name, args, node)
      case 'Math':
        if (MATH_METHODS.has(name)) {
          const method = (Math as unknown as Record<string, unknown>)[name]
          if (typeof method !== 'function') break
          const numeric = args.map((value) => Number(this.dataOperand(value, node)))
          return (method as (...values: number[]) => number)(...numeric)
        }
        break
      case 'JSON':
        if (name === 'parse') {
          if (typeof args[0] !== 'string') throw new CodeModeRuntimeError('TypeError', 'JSON.parse expects a string.', node)
          try {
            return copyBoundaryValue(JSON.parse(args[0]), 'JSON.parse result', node)
          } catch (error) {
            throw new CodeModeRuntimeError('TypeError', error instanceof Error ? error.message : String(error), node)
          }
        }
        if (name === 'stringify') {
          return JSON.stringify(copyBoundaryValue(args[0], 'JSON.stringify input', node))
        }
        break
      case 'Promise':
        return this.invokePromise(name, args, node)
      case 'console':
        if (['log', 'warn', 'error', 'dir', 'table'].includes(name)) return undefined
        break
      case 'Number':
        if (name === 'isFinite') return typeof args[0] === 'number' && Number.isFinite(args[0])
        if (name === 'isNaN') return typeof args[0] === 'number' && Number.isNaN(args[0])
        if (name === 'isInteger') return Number.isInteger(args[0])
        if (name === 'parseInt') return Number.parseInt(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
        if (name === 'parseFloat') return Number.parseFloat(String(args[0]))
        break
      case 'String':
        if (name === 'fromCharCode') return String.fromCharCode(...args.map((value) => Number(value)))
        if (name === 'fromCodePoint') return String.fromCodePoint(...args.map((value) => Number(value)))
        if (name === 'raw') {
          const template = args[0]
          if (!template || typeof template !== 'object' || !Array.isArray((template as Record<string, unknown>).raw)) {
            throw new CodeModeRuntimeError('TypeError', 'String.raw expects a template-like object with a raw array.', node)
          }
          const raw = (template as { raw: unknown[] }).raw
          let output = ''
          for (let index = 0; index < raw.length; index += 1) {
            output += String(raw[index])
            if (index + 1 < raw.length) output += String(args[index + 1] ?? '')
          }
          return output
        }
        break
    }
    throw new CodeModeRuntimeError('TypeError', `${namespace}.${name} is not available in Tidecode Code Mode.`, node)
  }

  private async invokeObject(name: string, args: unknown[], node: AstNode): Promise<unknown> {
    const value = args[0]
    const entriesOf = (input: unknown): Array<[string, unknown]> => {
      if (input instanceof ToolReference) return this.tools.keys(input).map((key) => [key, this.tools.member(input, key, node)])
      if (input instanceof PayloadNamespace) return input.entries()
      if (Array.isArray(input)) return Object.entries(input)
      if (!input || typeof input !== 'object') throw new CodeModeRuntimeError('TypeError', `Object.${name} expects a data object or array.`, node)
      return Object.entries(input)
    }
    if (name === 'keys') return entriesOf(value).map(([key]) => key)
    if (name === 'values') return entriesOf(value).map(([, item]) => item)
    if (name === 'entries') return entriesOf(value).map(([key, item]) => [key, item])
    if (name === 'hasOwn') {
      if (!value || typeof value !== 'object') return false
      return Object.hasOwn(value, String(args[1]))
    }
    if (name === 'assign') {
      const out: Record<string, unknown> = Object.create(null)
      for (const source of args) {
        if (source === null || source === undefined) continue
        const copied = copyBoundaryValue(source, 'Object.assign input', node)
        if (!copied || typeof copied !== 'object' || Array.isArray(copied)) {
          throw new CodeModeRuntimeError('TypeError', 'Object.assign expects data objects.', node)
        }
        for (const [key, item] of Object.entries(copied)) {
          if (BLOCKED_MEMBER_NAMES.has(key)) throw new CodeModeRuntimeError('TypeError', `Property '${key}' is blocked.`, node)
          out[key] = item
        }
      }
      return out
    }
    if (name === 'fromEntries') {
      if (!Array.isArray(value)) throw new CodeModeRuntimeError('TypeError', 'Object.fromEntries expects an array of pairs.', node)
      const out: Record<string, unknown> = Object.create(null)
      for (const pair of value) {
        if (!Array.isArray(pair) || pair.length < 2) throw new CodeModeRuntimeError('TypeError', 'Object.fromEntries expects [key, value] pairs.', node)
        const key = String(pair[0])
        if (BLOCKED_MEMBER_NAMES.has(key)) throw new CodeModeRuntimeError('TypeError', `Property '${key}' is blocked.`, node)
        out[key] = pair[1]
      }
      return out
    }
    throw new CodeModeRuntimeError('TypeError', `Object.${name} is not available in Tidecode Code Mode.`, node)
  }

  private invokePromise(name: string, args: unknown[], node: AstNode): CodePromise {
    if (name === 'resolve') return new CodePromise(Promise.resolve(this.resolveAwaitable(args[0])))
    if (name === 'reject') return new CodePromise(Promise.reject(args[0]))
    const input = args[0]
    if (!Array.isArray(input)) throw new CodeModeRuntimeError('TypeError', `Promise.${name} expects an array.`, node)
    const promises = input.map((value) => this.resolveAwaitable(value))
    if (name === 'all') return new CodePromise(Promise.all(promises))
    if (name === 'race') return new CodePromise(Promise.race(promises))
    if (name === 'allSettled') {
      return new CodePromise(Promise.allSettled(promises).then((settled) => settled.map((item) => (
        item.status === 'fulfilled'
          ? Object.assign(Object.create(null), { status: 'fulfilled', value: item.value })
          : Object.assign(Object.create(null), { status: 'rejected', reason: safeErrorValue(item.reason) })
      ))))
    }
    if (name === 'any') {
      return new CodePromise(Promise.any(promises).catch((error) => {
        throw new CodeModeRuntimeError('ExecutionError', error instanceof Error ? error.message : String(error), node)
      }))
    }
    throw new CodeModeRuntimeError('TypeError', `Promise.${name} is not available in Tidecode Code Mode.`, node)
  }

  private async invokeArray(array: unknown[], name: string, args: unknown[], node: AstNode): Promise<unknown> {
    const callback = args[0]
    if (['map', 'filter', 'find', 'findIndex', 'some', 'every', 'flatMap', 'forEach'].includes(name)) {
      if (!(callback instanceof CodeFunction) && !(callback instanceof NativeFunction)) {
        throw new CodeModeRuntimeError('TypeError', `Array.${name} expects a Code Mode function.`, node)
      }
      const mapped: unknown[] = []
      for (let index = 0; index < array.length; index += 1) {
        this.tick(node)
        const result = await this.invokeArrayCallback(callback, [array[index], index, array], node, false)
        if (name === 'map') mapped.push(result)
        else if (name === 'filter' && truthy(result)) mapped.push(array[index])
        else if (name === 'find' && truthy(result)) return array[index]
        else if (name === 'findIndex' && truthy(result)) return index
        else if (name === 'some' && truthy(result)) return true
        else if (name === 'every' && !truthy(result)) return false
        else if (name === 'flatMap') {
          if (Array.isArray(result)) mapped.push(...result)
          else mapped.push(result)
        }
      }
      if (name === 'find') return undefined
      if (name === 'findIndex') return -1
      if (name === 'some') return false
      if (name === 'every') return true
      if (name === 'forEach') return undefined
      return mapped
    }
    if (name === 'reduce') {
      if (!(callback instanceof CodeFunction) && !(callback instanceof NativeFunction)) {
        throw new CodeModeRuntimeError('TypeError', 'Array.reduce expects a Code Mode function.', node)
      }
      if (array.length === 0 && args.length < 2) throw new CodeModeRuntimeError('TypeError', 'Reduce of empty array with no initial value.', node)
      let index = args.length >= 2 ? 0 : 1
      let accumulator = args.length >= 2 ? args[1] : array[0]
      for (; index < array.length; index += 1) {
        this.tick(node)
        accumulator = await this.invokeArrayCallback(callback, [accumulator, array[index], index, array], node, true)
      }
      return accumulator
    }
    if (name === 'sort' || name === 'toSorted') {
      const target = name === 'sort' ? array : [...array]
      const comparator = args[0]
      for (let i = 1; i < target.length; i += 1) {
        for (let j = i; j > 0; j -= 1) {
          this.tick(node)
          let order: number
          if (comparator === undefined) order = this.coerceString(target[j - 1], node).localeCompare(this.coerceString(target[j], node))
          else {
            if (!(comparator instanceof CodeFunction) && !(comparator instanceof NativeFunction)) {
              throw new CodeModeRuntimeError('TypeError', 'Array.sort comparator must be a Code Mode function.', node)
            }
            order = Number(await this.invokeArrayCallback(comparator, [target[j - 1], target[j]], node, true))
          }
          if (order <= 0) break
          ;[target[j - 1], target[j]] = [target[j], target[j - 1]]
        }
      }
      return target
    }
    switch (name) {
      case 'includes': return array.includes(args[0], args[1] === undefined ? undefined : Number(args[1]))
      case 'join': return array.join(args[0] === undefined ? ',' : String(args[0]))
      case 'slice': return array.slice(args[0] === undefined ? undefined : Number(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'concat': return array.concat(...args)
      case 'indexOf': return array.indexOf(args[0], args[1] === undefined ? undefined : Number(args[1]))
      case 'lastIndexOf': return array.lastIndexOf(args[0], args[1] === undefined ? undefined : Number(args[1]))
      case 'at': return array.at(Number(args[0]))
      case 'flat': return array.flat(Math.max(0, Math.min(10, args[0] === undefined ? 1 : Number(args[0]))))
      case 'reverse': return array.reverse()
      case 'toReversed': return [...array].reverse()
      case 'push': return array.push(...args)
      case 'pop': return array.pop()
      case 'shift': return array.shift()
      case 'unshift': return array.unshift(...args)
      case 'splice': return array.splice(Number(args[0]), args[1] === undefined ? array.length : Number(args[1]), ...args.slice(2))
      default: throw new CodeModeRuntimeError('TypeError', `Array.${name} is not available in Tidecode Code Mode.`, node)
    }
  }

  private invokeString(value: string, name: string, args: unknown[], node: AstNode): unknown {
    switch (name) {
      case 'toLowerCase': return value.toLowerCase()
      case 'toUpperCase': return value.toUpperCase()
      case 'trim': return value.trim()
      case 'trimStart': return value.trimStart()
      case 'trimEnd': return value.trimEnd()
      case 'split': return args[0] === undefined
        ? [value]
        : value.split(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'slice': return value.slice(args[0] === undefined ? undefined : Number(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'substring': return value.substring(args[0] === undefined ? 0 : Number(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'includes': return value.includes(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'startsWith': return value.startsWith(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'endsWith': return value.endsWith(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'indexOf': return value.indexOf(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'lastIndexOf': return value.lastIndexOf(String(args[0]), args[1] === undefined ? undefined : Number(args[1]))
      case 'replace': return value.replace(String(args[0]), String(args[1] ?? ''))
      case 'replaceAll': return value.replaceAll(String(args[0]), String(args[1] ?? ''))
      case 'repeat': return value.repeat(Number(args[0]))
      case 'padStart': return value.padStart(Number(args[0]), args[1] === undefined ? undefined : String(args[1]))
      case 'padEnd': return value.padEnd(Number(args[0]), args[1] === undefined ? undefined : String(args[1]))
      case 'charAt': return value.charAt(Number(args[0]))
      case 'charCodeAt': return value.charCodeAt(Number(args[0]))
      case 'codePointAt': return value.codePointAt(Number(args[0]))
      case 'at': return value.at(Number(args[0]))
      case 'concat': return value.concat(...args.map(String))
      case 'localeCompare': return value.localeCompare(String(args[0]))
      case 'normalize': {
        if (args[0] === undefined) return value.normalize()
        const form = String(args[0])
        if (!['NFC', 'NFD', 'NFKC', 'NFKD'].includes(form)) {
          throw new CodeModeRuntimeError('TypeError', 'String.normalize form must be NFC, NFD, NFKC, or NFKD.', node)
        }
        return value.normalize(form as 'NFC' | 'NFD' | 'NFKC' | 'NFKD')
      }
      default: throw new CodeModeRuntimeError('TypeError', `String.${name} is not available in Tidecode Code Mode.`, node)
    }
  }

  private async invokeArrayCallback(
    callback: CodeFunction | NativeFunction,
    args: unknown[],
    node: AstNode,
    resolveAsync: boolean,
  ): Promise<unknown> {
    if (callback instanceof NativeFunction) return callback.invoke(args, node)
    if (callback.isAsync) {
      const promise = new CodePromise(this.invokeFunction(callback, args, node))
      return resolveAsync ? promise.promise : promise
    }
    return this.invokeFunction(callback, args, node)
  }

  private coerceString(value: unknown, node: AstNode): string {
    const data = this.dataOperand(value, node)
    if (data === null) return 'null'
    if (data === undefined) return 'undefined'
    if (typeof data === 'object') {
      try {
        return JSON.stringify(copyBoundaryValue(data, 'String conversion', node))
      } catch {
        return '[object Object]'
      }
    }
    return String(data)
  }
}
