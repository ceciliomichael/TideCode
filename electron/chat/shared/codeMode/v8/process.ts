import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodeModeRuntimeError, toDiagnostic, type CodeModeDiagnostic } from '../diagnostics'
import type { CodeModeExecutionLimits } from '../types'
import type { ToolRuntime } from '../toolRuntime'

export function resolveCodeModeWorker() {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (process.versions.electron && resourcesPath) {
    const directory = path.join(resourcesPath, 'cli')
    const entry = path.join(directory, 'code-mode-worker.mjs')
    const executable = path.join(directory, process.platform === 'win32' ? 'node.exe' : 'node')
    if (existsSync(entry) && existsSync(executable)) {
      return { entry, executable }
    }
  }

  const directory = path.dirname(fileURLToPath(import.meta.url))
  const sourceEntry = path.join(directory, 'worker.mjs')
  const entry = existsSync(sourceEntry) ? sourceEntry : path.join(directory, 'code-mode-worker.mjs')
  if (!existsSync(entry)) {
    throw new Error(`Code Mode worker is missing: ${entry}. Rebuild the runtime.`)
  }
  if (!process.versions.electron) {
    return { entry, executable: process.execPath }
  }

  const nodeExecutable = process.env.npm_node_execpath
  if (nodeExecutable && existsSync(nodeExecutable)) {
    return { entry, executable: nodeExecutable }
  }
  throw new Error('Code Mode requires the bundled Node runtime. Run npm run build:cli before starting Electron.')
}

export interface WorkerResult {
  recoveries?: string[]
  output?: unknown
  outputTruncated?: boolean
}

export function runCodeModeProcess(options: {
  source: string
  payloads: Readonly<Record<string, string>>
  limits: CodeModeExecutionLimits
  runtime: ToolRuntime
  abortSignal: AbortSignal
}): Promise<WorkerResult> {
  if (options.abortSignal.aborted) {
    return Promise.reject(new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.'))
  }
  const launch = resolveCodeModeWorker()
  return new Promise((resolve, reject) => {
    // Do not inherit debugger hooks, NODE_OPTIONS, or loader injections into the execution host.
    const environment = { ...process.env }
    delete environment.NODE_OPTIONS
    delete environment.NODE_PATH
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(launch.executable, ['--no-node-snapshot', '--disable-proto=throw', launch.entry], {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
    })
    let finished = false
    let stderr = ''
    const finish = (error?: unknown, result?: WorkerResult) => {
      if (finished) {
        return
      }
      finished = true
      options.abortSignal.removeEventListener('abort', abort)
      child.kill()
      if (error) {
        reject(error)
      } else {
        resolve(result ?? {})
      }
    }
    const abort = () => finish(new CodeModeRuntimeError('Cancelled', 'Code Mode execution was aborted.'))
    options.abortSignal.addEventListener('abort', abort, { once: true })
    if (options.abortSignal.aborted) {
      abort()
      return
    }
    child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString('utf8')).slice(-4000)
    })
    child.on('error', (error) => finish(error))
    child.on('exit', (code, signal) => {
      finish(new CodeModeRuntimeError('ExecutionError', `Code Mode worker exited (${signal ?? code}). ${stderr.trim()}`))
    })
    child.on('message', (message: unknown) => {
      if (finished || !message || typeof message !== 'object') {
        return
      }
      const data = message as Record<string, unknown>
      if (data.type === 'result') {
        const recoveries = data.recoveries
        if (recoveries !== undefined && (!Array.isArray(recoveries) || recoveries.length > 128
          || recoveries.some((note) => typeof note !== 'string' || note.length > 400))) {
          finish(new CodeModeRuntimeError('ExecutionError', 'Invalid Code Mode recovery receipt.'))
          return
        }
        const output = JSON.stringify(data.output)
        if (output !== undefined && Buffer.byteLength(output, 'utf8') > options.limits.maxOutputBytes) {
          finish(undefined, {
            output: { message: `Code Mode output exceeded the ${options.limits.maxOutputBytes}-byte limit. Return a smaller summary from the program.` },
            outputTruncated: true,
          })
        } else {
          finish(undefined, { output: data.output, outputTruncated: data.outputTruncated === true, recoveries: recoveries as string[] | undefined })
        }
      } else if (data.type === 'error') {
        const diagnostic = data.diagnostic as CodeModeDiagnostic
        if (!diagnostic || typeof diagnostic.kind !== 'string' || typeof diagnostic.message !== 'string') {
          finish(new CodeModeRuntimeError('ExecutionError', 'The isolated program returned an invalid error result.'))
        } else {
          finish(new CodeModeRuntimeError(diagnostic.kind, diagnostic.message, diagnostic.location))
        }
      } else if (data.type === 'tool') {
        void (async () => {
          let response: Record<string, unknown>
          try {
            if (typeof data.path !== 'string' || !Array.isArray(data.args) || !Number.isSafeInteger(data.id)) {
              throw new CodeModeRuntimeError('InvalidToolArguments', 'Invalid Code Mode tool request.')
            }
            const value = await options.runtime.call(data.path, data.args)
            response = { type: 'tool-result', id: data.id, value }
          } catch (error) {
            const diagnostic = toDiagnostic(error)
            if (diagnostic.kind === 'ToolContractRequired') {
              finish(error)
              return
            }
            response = { type: 'tool-result', id: data.id, diagnostic }
          }
          if (!finished && child.connected) {
            child.send(response, (error) => {
              if (error) {
                finish(error)
              }
            })
          }
        })().catch((error) => finish(error))
      }
    })
    child.send({
      type: 'execute',
      source: options.source,
      payloads: options.payloads,
      limits: options.limits,
      paths: options.runtime.paths(),
    }, (error) => {
      if (error) {
        finish(error)
      }
    })
  })
}
