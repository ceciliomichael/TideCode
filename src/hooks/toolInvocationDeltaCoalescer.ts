export const TOOL_INVOCATION_DELTA_RENDER_INTERVAL_MS = 32

export interface ToolInvocationDeltaValue {
  argumentsText: string
  toolName: string
}

type ToolInvocationDeltaConsumer = (invocationId: string, value: ToolInvocationDeltaValue) => void

export class ToolInvocationDeltaCoalescer {
  private readonly pendingByInvocationId = new Map<string, ToolInvocationDeltaValue>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly consume: ToolInvocationDeltaConsumer,
    private readonly delayMs = TOOL_INVOCATION_DELTA_RENDER_INTERVAL_MS,
  ) {}

  enqueue(invocationId: string, value: ToolInvocationDeltaValue): void {
    this.pendingByInvocationId.set(invocationId, value)
    if (this.timer !== null) return

    this.timer = setTimeout(() => {
      this.timer = null
      this.flushPending()
    }, this.delayMs)
    this.timer.unref?.()
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flushPending()
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pendingByInvocationId.clear()
  }

  private flushPending(): void {
    if (this.pendingByInvocationId.size === 0) return

    const pending = [...this.pendingByInvocationId.entries()]
    this.pendingByInvocationId.clear()
    for (const [invocationId, value] of pending) {
      this.consume(invocationId, value)
    }
  }
}
