import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { AgentToolExecutionResult } from '../../toolTypes'
import type { AgentToolRegistry, AgentToolRegistryEntry } from '../../tools/registry'
import { getCodeModeToolCallStatus } from '../toolCallStatus'
import type { CodeModeExecutionLimits, CodeModeToolCallRecord } from '../types'
import { CodeModeRuntimeError, CodePromise, ToolReference, type AstNode } from './model'
import { copyBoundaryValue } from './values'
import { searchAvailableApis } from '../../ai/tools/available/search/search'
import { getAvailableApi } from '../../ai/tools/available/get/get'

const HIDDEN_MODEL_SEMANTIC_KEYS = new Set([
  'active',
  'available_line_count',
  'broker_session_id',
  'first_available_line',
  'has_more',
  'is_directory',
  'last_available_line',
  'line_count',
  'new_output_line_count',
  'omitted_bytes',
  'omitted_lines',
  'operation_id',
  'original_approximate_tokens',
  'returned_line_count',
  'total_output_lines',
  'visible_line_ranges',
  'wait_seconds',
])

const MUTATING_FILE_TOOLS = new Set(['patch', 'write'])
const RESERVED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

class AsyncSemaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async use<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active += 1
    try {
      return await work()
    } finally {
      this.active -= 1
      this.waiting.shift()?.()
    }
  }
}

class MutationQueue {
  private readonly tails = new Map<string, Promise<void>>()

  async use<T>(keys: readonly string[], work: () => Promise<T>): Promise<T> {
    const unique = [...new Set(keys)].sort()
    if (unique.length === 0) return work()
    const predecessors = unique.map((key) => this.tails.get(key)).filter((item): item is Promise<void> => Boolean(item))
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    for (const key of unique) this.tails.set(key, current)
    await Promise.allSettled(predecessors)
    try {
      return await work()
    } finally {
      release()
      for (const key of unique) if (this.tails.get(key) === current) this.tails.delete(key)
    }
  }
}

interface ProjectedTool {
  entry: AgentToolRegistryEntry
  path: string[]
  expression: string
}

export interface ToolSearchInput {
  query?: string
  namespace?: string
  limit?: number
  offset?: number
}

export interface ToolRuntimeOptions {
  obtainedTools: Set<string>
  discoveredMcpTools: Set<string>
  abortSignal: AbortSignal
  allowedToolNames?: readonly string[]
  executionId: string
  limits: CodeModeExecutionLimits
  toolCalls: CodeModeToolCallRecord[]
  workspaceRootPath: string
}

function safeSegment(raw: string): string {
  let value = raw.replace(/[^A-Za-z0-9_$]/gu, '_')
  if (!/^[A-Za-z_$]/u.test(value)) value = `_${value}`
  if (RESERVED_SEGMENTS.has(value)) value = `_${value}`
  return value || '_tool'
}

function modelSemantics(semantics: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!semantics) return undefined
  const projected = Object.fromEntries(Object.entries(semantics).filter(([key]) => !HIDDEN_MODEL_SEMANTIC_KEYS.has(key)))
  return Object.keys(projected).length > 0 ? projected : undefined
}

function serializeResult(result: AgentToolExecutionResult): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null)
  if (result.body !== undefined) out.body = result.body
  out.status = result.status
  out.summary = result.summary
  if (result.truncated !== undefined) out.truncated = result.truncated
  const rawSemantics = result.semantics
  const semantics = modelSemantics(rawSemantics)
  if (semantics) out.semantics = copyBoundaryValue(semantics, 'Tool result semantics')
  if (result.subject) out.subject = copyBoundaryValue(result.subject, 'Tool result subject')
  if (rawSemantics && typeof rawSemantics.session_id === 'number') out.session_id = rawSemantics.session_id
  if (rawSemantics && typeof rawSemantics.exit_code === 'number') out.exit_code = rawSemantics.exit_code
  if (rawSemantics && typeof rawSemantics.state === 'string') out.state = rawSemantics.state
  if (rawSemantics && typeof rawSemantics.output_path === 'string') out.output_path = rawSemantics.output_path
  if (
    rawSemantics
    && typeof rawSemantics.session_id === 'number'
    && typeof rawSemantics.new_output_line_count === 'number'
  ) {
    out.new_output = rawSemantics.new_output_line_count > 0
      ? (result.displayBody ?? result.body ?? '')
      : ''
  }
  return out
}

function toolFailure(name: string, result: AgentToolExecutionResult): CodeModeRuntimeError {
  const message = result.body || result.displayBody || result.summary || `Tool '${name}' failed.`
  if (/invalid arguments|input validation/iu.test(message)) {
    return new CodeModeRuntimeError('InvalidToolArguments', message)
  }
  if (/permission|not permitted|denied|read.only|read-only/iu.test(message)) {
    return new CodeModeRuntimeError('PermissionDenied', message)
  }
  return new CodeModeRuntimeError('ToolExecutionError', message)
}

function dynamicToolValue(result: AgentToolExecutionResult): unknown {
  const body = result.displayBody ?? result.body
  if (typeof body !== 'string') return body
  const trimmed = body.trim()
  if (trimmed.length === 0) return ''
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return body
  }
}

function schemaSignature(tool: ProjectedTool): string {
  const schema = JSON.stringify(tool.entry.inputSchema)
  const bounded = schema.length > 1200 ? `${schema.slice(0, 1197)}...` : schema
  const returnType = tool.entry.namespace === 'mcp' ? 'McpValue' : 'ToolResult'
  return `${tool.expression}(input: ${bounded}): Promise<${returnType}>`
}

export class ToolRuntime {
  private readonly mutationQueue = new MutationQueue()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly projectedByPath = new Map<string, ProjectedTool>()
  private readonly childNames = new Map<string, Set<string>>()
  private readonly semaphore: AsyncSemaphore
  private callCount = 0

  constructor(registry: AgentToolRegistry, private readonly options: ToolRuntimeOptions) {
    this.semaphore = new AsyncSemaphore(Math.max(1, options.limits.maxConcurrentToolCalls))
    const allowed = options.allowedToolNames ? new Set(options.allowedToolNames) : null
    const usedPaths = new Set<string>()
    for (const entry of registry.entries) {
      if (allowed && !allowed.has(entry.name)) continue
      const base = entry.namespace === 'mcp'
        ? ['mcp', safeSegment(entry.name.replace(/^mcp[_:-]?/iu, ''))]
        : entry.name.split('.')
      if (base.some((segment) => segment !== safeSegment(segment))) {
        throw new Error(`Invalid native API path: tools.${entry.name}`)
      }
      const candidate = base
      if (usedPaths.has(candidate.join('.'))) {
        throw new Error(`Duplicate Code Mode API path: tools.${candidate.join('.')}`)
      }
      usedPaths.add(candidate.join('.'))
      const projected: ProjectedTool = {
        entry,
        path: candidate,
        expression: `tools.${candidate.join('.')}`,
      }
      this.projectedByPath.set(candidate.join('.'), projected)
      for (let i = 0; i < candidate.length; i += 1) {
        const parent = candidate.slice(0, i).join('.')
        const children = this.childNames.get(parent) ?? new Set<string>()
        children.add(candidate[i]!)
        this.childNames.set(parent, children)
      }
    }
    const rootChildren = this.childNames.get('') ?? new Set<string>()
    rootChildren.add('available')
    this.childNames.set('', rootChildren)
    this.childNames.set('available', new Set(['search', 'get']))
    for (const key of this.projectedByPath.keys()) {
      if (this.childNames.has(key)) {
        throw new Error(`Code Mode API path is both a namespace and callable: tools.${key}`)
      }
    }
  }

  unavailableAllowedTool(): string | undefined {
    return this.options.allowedToolNames?.find(
      (name) => ![...this.projectedByPath.values()].some((tool) => tool.entry.name === name),
    )
  }

  root(): ToolReference {
    return new ToolReference([])
  }

  member(reference: ToolReference, name: string, node: AstNode): ToolReference {
    if (RESERVED_SEGMENTS.has(name)) {
      throw new CodeModeRuntimeError('TypeError', `Property '${name}' is not available in Code Mode.`, node)
    }
    const next = [...reference.path, name]
    const key = next.join('.')
    if (this.projectedByPath.has(key) || this.childNames.has(key) || key === 'available.search' || key === 'available.get') {
      return new ToolReference(next)
    }
    const parentPath = reference.path.join('.')
    const available = parentPath === 'mcp'
      ? []
      : [...(this.childNames.get(parentPath) ?? [])].slice(0, 8)
    throw new CodeModeRuntimeError(
      'UnknownTool',
      `Unknown Code Mode capability tools.${key}.`,
      node,
      available.length > 0 ? [`Available here: ${available.join(', ')}. Use tools.available.search(...) for discovery.`] : ['Use tools.available.search(...) for discovery.'],
    )
  }

  keys(reference: ToolReference): string[] {
    const parentPath = reference.path.join('.')
    if (parentPath === 'mcp') {
      return [...this.options.discoveredMcpTools].map((name) => name.slice('tools.mcp.'.length)).sort()
    }
    return [...(this.childNames.get(parentPath) ?? [])].sort()
  }

  call(reference: ToolReference, args: unknown[], node: AstNode): CodePromise {
    const key = reference.path.join('.')
    if (key === 'available.search') {
      const result = this.search(args[0], node)
      this.recordDiscovery('available.search', args[0], result, 'Searched tools')
      return this.track(Promise.resolve(result))
    }
    if (key === 'available.get') {
      const result = this.get(args[0], node)
      this.recordDiscovery('available.get', args[0], result, 'Retrieved tools')
      return this.track(Promise.resolve(result))
    }
    const tool = this.projectedByPath.get(key)
    if (!tool) throw new CodeModeRuntimeError('UnknownTool', `tools.${key} is not callable.`, node)
    if (!this.options.obtainedTools.has(key)) {
      if (tool.entry.namespace === 'mcp' && !this.options.discoveredMcpTools.has(tool.expression)) {
        throw new CodeModeRuntimeError('UnknownTool', `Search for this MCP capability with tools.available.search before using it.`, node)
      }
      const contract = this.get({ name: tool.expression }, node)
      this.recordDiscovery('available.get', { name: tool.expression }, contract, 'Retrieved tools')
      throw new CodeModeRuntimeError(
        'ToolContractRequired',
        `The attempted ${tool.expression} call was not executed because its instructions had not been retrieved. TideCode retrieved them now. Review this complete tools.available.get result and retry the operation with the correct arguments:\n${JSON.stringify(contract, null, 2)}`,
        node,
      )
    }
    if (args.length !== 1) {
      throw new CodeModeRuntimeError('InvalidToolArguments', `${tool.expression} expects exactly one input value.`, node)
    }
    const input = copyBoundaryValue(args[0], `Arguments for ${tool.expression}`, node)
    return this.track(this.execute(tool, input))
  }

  async drain(): Promise<void> {
    if (this.pending.size === 0) return
    await Promise.allSettled([...this.pending])
  }

  private track(promise: Promise<unknown>): CodePromise {
    this.pending.add(promise)
    void promise.then(
      () => this.pending.delete(promise),
      () => this.pending.delete(promise),
    )
    return new CodePromise(promise)
  }

  private recordDiscovery(name: string, input: unknown, result: unknown, summary: string): void {
    this.options.toolCalls.push({
      arguments: copyBoundaryValue(input ?? {}, 'Discovery receipt arguments'),
      body: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      durationMs: 0,
      name,
      status: 'success',
      summary,
    })
  }

  private search(input: unknown, node: AstNode): Record<string, unknown> {
    const raw = input === undefined ? Object.create(null) : copyBoundaryValue(input, 'Code Mode search input', node)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new CodeModeRuntimeError('InvalidToolArguments', 'tools.available.search expects an object.', node)
    }

    const value = raw as ToolSearchInput
    const query = typeof value.query === 'string' ? value.query.trim().toLowerCase() : ''
    const namespace = typeof value.namespace === 'string' ? value.namespace.trim().toLowerCase() : undefined
    const limit = Number.isInteger(value.limit) ? Math.max(1, Math.min(50, Number(value.limit))) : 10
    const offset = Number.isInteger(value.offset) ? Math.max(0, Number(value.offset)) : 0
    const result = searchAvailableApis([...this.projectedByPath.values()].map((tool) => ({
      path: tool.expression,
      description: tool.entry.description,
      namespace: tool.entry.namespace,
      signature: schemaSignature(tool),
    })), { query, namespace, limit, offset })
    for (const item of result.items) {
      if (item.name.startsWith('tools.mcp.')) this.options.discoveredMcpTools.add(item.name)
    }
    return result
  }

  private get(input: unknown, node: AstNode): string {
    const raw = copyBoundaryValue(input, 'Available get input', node)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).some((key) => key !== 'name')
      || typeof (raw as Record<string, unknown>).name !== 'string') {
      throw new CodeModeRuntimeError('InvalidToolArguments', 'tools.available.get requires exactly { name: string }.', node)
    }
    const name = (raw as { name: string }).name
    const tool = [...this.projectedByPath.values()].find((item) => item.expression === name)
    if (!tool) throw new CodeModeRuntimeError('UnknownTool', `Unknown or unauthorized API: ${name}.`, node)
    if (tool.entry.namespace === 'mcp' && !this.options.discoveredMcpTools.has(name)) {
      throw new CodeModeRuntimeError('PermissionDenied', `Discover MCP API ${name} using tools.available.search before get.`, node)
    }
    this.options.obtainedTools.add(tool.path.join('.'))
    return getAvailableApi(tool.entry, tool.expression)
  }

  private async mutationKeys(tool: ProjectedTool, input: unknown): Promise<string[]> {
    if (!MUTATING_FILE_TOOLS.has(tool.entry.name)) return []
    // A patch can touch multiple files, so serialize all native mutations
    // through one queue rather than racing an independent whole-file write.
    if (tool.entry.name === 'patch' || tool.entry.name === 'write') return ['__workspace_mutation__']
    if (!input || typeof input !== 'object' || Array.isArray(input)) return ['__workspace_mutation__']
    const rawPath = (input as Record<string, unknown>).path
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) return ['__workspace_mutation__']
    const resolved = path.resolve(this.options.workspaceRootPath, rawPath)
    try {
      return [process.platform === 'win32' ? (await realpath(resolved)).toLowerCase() : await realpath(resolved)]
    } catch {
      return [process.platform === 'win32' ? resolved.toLowerCase() : resolved]
    }
  }

  private async execute(tool: ProjectedTool, input: unknown): Promise<unknown> {
    if (this.options.abortSignal.aborted) {
      throw new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.')
    }
    if (this.callCount >= this.options.limits.maxToolCalls) {
      throw new CodeModeRuntimeError(
        'ToolCallLimitExceeded',
        `Code Mode exceeded the ${this.options.limits.maxToolCalls}-tool-call limit.`,
      )
    }
    const callIndex = this.callCount
    this.callCount += 1
    const startedAt = Date.now()
    const keys = await this.mutationKeys(tool, input)
    const run = async (): Promise<AgentToolExecutionResult> => {
      if (this.options.abortSignal.aborted) throw new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.')
      return tool.entry.execute(input, {
        abortSignal: this.options.abortSignal,
        toolCallId: `${this.options.executionId}-v2-${callIndex + 1}`,
      })
    }
    let result: AgentToolExecutionResult
    try {
      result = await this.semaphore.use(() => this.mutationQueue.use(keys, run))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.toolCalls.push({
        arguments: copyBoundaryValue(input, 'Tool receipt arguments'),
        body: message,
        durationMs: Date.now() - startedAt,
        name: tool.entry.name,
        status: 'error',
        summary: message,
      })
      throw error instanceof CodeModeRuntimeError ? error : new CodeModeRuntimeError('ToolExecutionError', message)
    }
    const status = getCodeModeToolCallStatus(result)
    this.options.toolCalls.push({
      arguments: copyBoundaryValue(input, 'Tool receipt arguments'),
      body: result.displayBody ?? result.body,
      durationMs: Date.now() - startedAt,
      name: tool.entry.name,
      ...(result.resultPresentation ? { resultPresentation: result.resultPresentation } : {}),
      ...(result.semantics ? { semantics: copyBoundaryValue(result.semantics, 'Tool receipt semantics') as Record<string, unknown> } : {}),
      status,
      ...(result.subject ? { subject: result.subject } : {}),
      summary: result.summary,
    })
    if (result.status === 'error' || status === 'error') throw toolFailure(tool.entry.name, result)
    return tool.entry.namespace === 'mcp' ? dynamicToolValue(result) : serializeResult(result)
  }
}
