import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import path from 'node:path'
import type { IPty } from 'node-pty'

export interface TerminalProcessTerminationAttempt {
  error: string | null
  method: 'taskkill' | 'pty-kill'
  status: number | null
}

export interface TerminalProcessTerminationResult {
  attempts: TerminalProcessTerminationAttempt[]
  processId: number | null
  terminated: boolean
}

export interface TerminalProcessTerminationDependencies {
  isProcessAlive?: (processId: number) => boolean
  platform?: NodeJS.Platform
  spawn?: typeof spawnSync
  systemRoot?: string | null
}

function defaultIsProcessAlive(processId: number) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function resultError(result: SpawnSyncReturns<Buffer | string>) {
  if (result.error) return result.error.message
  if (result.status !== 0) return `Process terminator exited with status ${String(result.status)}.`
  return null
}

function callPtyKill(ptyProcess: IPty): TerminalProcessTerminationAttempt {
  try {
    ptyProcess.kill()
    return { error: null, method: 'pty-kill', status: 0 }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      method: 'pty-kill',
      status: null,
    }
  }
}

export function terminatePtyProcessTree(
  ptyProcess: IPty,
  dependencies: TerminalProcessTerminationDependencies = {},
): TerminalProcessTerminationResult {
  const platform = dependencies.platform ?? process.platform
  const spawn = dependencies.spawn ?? spawnSync
  const isProcessAlive = dependencies.isProcessAlive ?? defaultIsProcessAlive
  const processId = typeof ptyProcess.pid === 'number' && ptyProcess.pid > 0 ? ptyProcess.pid : null
  const attempts: TerminalProcessTerminationAttempt[] = []

  if (platform === 'win32' && processId !== null) {
    const systemRoot = dependencies.systemRoot?.trim()
      || process.env.SystemRoot?.trim()
      || process.env.WINDIR?.trim()
      || 'C:\\Windows'
    const taskkillPath = path.win32.join(systemRoot, 'System32', 'taskkill.exe')
    const taskkillResult = spawn(taskkillPath, ['/PID', String(processId), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const taskkillError = resultError(taskkillResult)
    attempts.push({ error: taskkillError, method: 'taskkill', status: taskkillResult.status })

    if (taskkillError || isProcessAlive(processId)) {
      attempts.push(callPtyKill(ptyProcess))
    }
  } else {
    attempts.push(callPtyKill(ptyProcess))
  }

  return {
    attempts,
    processId,
    terminated: processId === null || !isProcessAlive(processId),
  }
}