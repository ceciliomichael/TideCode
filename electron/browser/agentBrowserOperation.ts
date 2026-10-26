const COMMAND_TIMEOUT_MS = 6_000
const OPERATION_TIMEOUT_MS = 20_000

/** One budget for a protocol operation, including initialization and commands. */
export class AgentBrowserOperation {
  private readonly startedAt = Date.now()
  private failure: Error | null = null

  constructor(private readonly timeoutMs = OPERATION_TIMEOUT_MS, private readonly signal?: AbortSignal) {}

  async run<T>(
    stage: string,
    action: () => Promise<T>,
    onTimeout: () => void,
    commandTimeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    if (this.signal?.aborted) throw new Error('Browser operation cancelled.')
    if (this.failure) throw this.failure
    const remaining = Math.min(commandTimeoutMs, this.timeoutMs - (Date.now() - this.startedAt))
    if (remaining <= 0) {
      this.failure = new Error('Browser operation exhausted its time budget before ' + stage + '.')
      onTimeout()
      throw this.failure
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      return await new Promise<T>((resolve, reject) => {
        onAbort = () => {
          this.failure = new Error('Browser operation cancelled.')
          try { onTimeout() } catch { /* Chromium may already be detached. */ }
          reject(this.failure)
        }
        this.signal?.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => {
          this.failure = new Error('Browser operation timed out during ' + stage
            + ' after ' + (Date.now() - this.startedAt) + 'ms. The operation was stopped; actions were not retried.')
          try {
            onTimeout()
          } catch {
            // Preserve the timed-out stage even if Chromium has already detached.
          }
          reject(this.failure)
        }, remaining)
        // Consume late rejections and never start another command after timeout.
        Promise.resolve().then(() => {
          if (this.signal?.aborted) throw new Error('Browser operation cancelled.')
          if (this.failure) throw this.failure
          return action()
        }).then(resolve, reject)
      })
    } finally {
      if (timer) clearTimeout(timer)
      if (onAbort) this.signal?.removeEventListener('abort', onAbort)
    }
  }
}
