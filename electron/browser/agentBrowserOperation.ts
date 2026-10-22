const COMMAND_TIMEOUT_MS = 6_000
const OPERATION_TIMEOUT_MS = 20_000

/** One budget for a protocol operation, including initialization and commands. */
export class AgentBrowserOperation {
  private readonly startedAt = Date.now()
  private failure: Error | null = null

  constructor(private readonly timeoutMs = OPERATION_TIMEOUT_MS) {}

  async run<T>(
    stage: string,
    action: () => Promise<T>,
    onTimeout: () => void,
    commandTimeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<T> {
    if (this.failure) throw this.failure
    const remaining = Math.min(commandTimeoutMs, this.timeoutMs - (Date.now() - this.startedAt))
    if (remaining <= 0) {
      this.failure = new Error('Browser operation exhausted its time budget before ' + stage + '.')
      onTimeout()
      throw this.failure
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<T>((resolve, reject) => {
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
          if (this.failure) throw this.failure
          return action()
        }).then(resolve, reject)
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
