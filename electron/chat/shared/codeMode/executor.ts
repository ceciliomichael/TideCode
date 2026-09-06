import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AppTerminalExecutionMode } from '../../../../src/types/chat'
import type { AgentToolRegistry } from '../tools/registry'
import type { CodeModeExecutionLimits, CodeModeExecutionResult } from './types'
import { executeCodeModeV2 } from './v2/engine'

export class CodeModeExecutor {
  private readonly workspaceRootPath: string

  public constructor(
    private readonly registry: AgentToolRegistry,
    _preloadedToolNames?: readonly string[],
    options: {
      terminalExecutionMode?: AppTerminalExecutionMode
      workspaceRootPath?: string
    } = {},
  ) {
    this.workspaceRootPath = path.resolve(options.workspaceRootPath ?? process.cwd())
  }

  public async run(
    source: string,
    options: {
      abortSignal?: AbortSignal
      allowedToolNames?: readonly string[]
      limits?: Partial<CodeModeExecutionLimits>
    } = {},
  ): Promise<CodeModeExecutionResult> {
    return executeCodeModeV2({
      abortSignal: options.abortSignal,
      allowedToolNames: options.allowedToolNames,
      executionId: randomUUID(),
      limits: options.limits,
      registry: this.registry,
      source,
      workspaceRootPath: this.workspaceRootPath,
    })
  }

  public async dispose(): Promise<void> {
    // Code Mode V2 owns no persistent execution worker.
  }
}
