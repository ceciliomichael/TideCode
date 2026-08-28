import { spawn } from 'node:child_process'
import path from 'node:path'
import type { IPty } from 'node-pty'

const DEFAULT_TASKKILL_TIMEOUT_MS = 2_000

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
  runTaskkill?: (command: string, args: string[], timeoutMs: number) => Promise<TerminalProcessTerminationAttempt>
  systemRoot?: string | null
  taskkillTimeoutMs?: number
}

function defaultIsProcessAlive(processId: number) {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
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

async function runTaskkill(command: string, args: string[], timeoutMs: number): Promise<TerminalProcessTerminationAttempt> {
  return await new Promise((resolve) => {
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch (error) {
      resolve({
        error: error instanceof Error ? error.message : String(error),
        method: 'taskkill',
        status: null,
      })
      return
    }
    const finish = (attempt: TerminalProcessTerminationAttempt) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(attempt)
    }

    child.once('error', (error) => {
      finish({ error: error.message, method: 'taskkill', status: null })
    })
    child.once('close', (status) => {
      finish({
        error: status === 0 ? null : `Process terminator exited with status ${String(status)}.`,
        method: 'taskkill',
        status,
      })
    })
    const timeoutId = setTimeout(() => {
      child.kill()
      finish({
        error: `Process terminator timed out after ${timeoutMs}ms.`,
        method: 'taskkill',
        status: null,
      })
    }, timeoutMs)
    timeoutId.unref?.()
  })
}

export async function terminatePtyProcessTree(
  ptyProcess: IPty,
  dependencies: TerminalProcessTerminationDependencies = {},
): Promise<TerminalProcessTerminationResult> {
  const platform = dependencies.platform ?? process.platform
  const isProcessAlive = dependencies.isProcessAlive ?? defaultIsProcessAlive
  const processId = typeof ptyProcess.pid === 'number' && ptyProcess.pid > 0 ? ptyProcess.pid : null
  const attempts: TerminalProcessTerminationAttempt[] = []

  if (platform === 'win32' && processId !== null) {
    const systemRoot = dependencies.systemRoot?.trim()
      || process.env.SystemRoot?.trim()
      || process.env.WINDIR?.trim()
      || 'C:\\Windows'
    const taskkillPath = path.win32.join(systemRoot, 'System32', 'taskkill.exe')
    let taskkillAttempt: TerminalProcessTerminationAttempt
    try {
      taskkillAttempt = await (dependencies.runTaskkill ?? runTaskkill)(
        taskkillPath,
        ['/PID', String(processId), '/T', '/F'],
        dependencies.taskkillTimeoutMs ?? DEFAULT_TASKKILL_TIMEOUT_MS,
      )
    } catch (error) {
      taskkillAttempt = {
        error: error instanceof Error ? error.message : String(error),
        method: 'taskkill',
        status: null,
      }
    }
    attempts.push(taskkillAttempt)

    if (taskkillAttempt.error || isProcessAlive(processId)) {
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
