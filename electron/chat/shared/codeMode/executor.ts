import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import type { AgentToolRegistry } from '../tools/registry'
import type { CodeModeExecutionLimits, CodeModeExecutionResult } from './types'
import { executeCodeMode } from './v8/engine'
import type { ToolDiscoveryState } from '../ai/registry/sessionDiscovery'

export class CodeModeExecutor {
  private readonly activeExecutions = new Set<AbortController>()
  private readonly workspaceRootPath: string
  private readonly discoveryState: ToolDiscoveryState

  public constructor(
    private readonly registry: AgentToolRegistry,
    _preloadedToolNames?: readonly string[],
    options: {
      terminalExecutionMode?: AppTerminalExecutionMode
      workspaceRootPath?: string
      discoveryState?: ToolDiscoveryState
    } = {},
  ) {
    this.workspaceRootPath = path.resolve(options.workspaceRootPath ?? process.cwd())
    this.discoveryState = options.discoveryState ?? { obtainedTools: new Set(), discoveredMcpTools: new Set() }
  }

  public async run(
    source: string,
    options: {
      abortSignal?: AbortSignal
      allowedToolNames?: readonly string[]
      limits?: Partial<CodeModeExecutionLimits>
      payloads?: Readonly<Record<string, string>>
    } = {},
  ): Promise<CodeModeExecutionResult> {
    const controller = new AbortController()
    const abort = () => controller.abort(options.abortSignal?.reason)
    options.abortSignal?.addEventListener('abort', abort, { once: true })
    if (options.abortSignal?.aborted) {
      abort()
    }
    this.activeExecutions.add(controller)
    try {
      return await executeCodeMode({
        abortSignal: controller.signal,
        allowedToolNames: options.allowedToolNames,
        executionId: randomUUID(),
        limits: options.limits,
        payloads: options.payloads,
        registry: this.registry,
        obtainedTools: this.discoveryState.obtainedTools,
        discoveredMcpTools: this.discoveryState.discoveredMcpTools,
        source,
        workspaceRootPath: this.workspaceRootPath,
      })
    } finally {
      this.activeExecutions.delete(controller)
      options.abortSignal?.removeEventListener('abort', abort)
    }
  }

  public async dispose(): Promise<void> {
    for (const controller of this.activeExecutions) {
      controller.abort()
    }
    this.activeExecutions.clear()
  }
}
