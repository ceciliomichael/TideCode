import type { TerminalBrokerEvent } from '../../../src/types/chat'

export const TERMINAL_OUTPUT_BATCH_DELAY_MS = 8
export const TERMINAL_OUTPUT_BATCH_MAX_LENGTH = 64 * 1024

type TerminalOutputEvent = Extract<TerminalBrokerEvent, { type: 'terminal_output' }>

interface PendingTerminalOutputEvent {
  clientIds: string[]
  chunks: string[]
  endCursor: number
  legacySessionId: number
  length: number
  outputEvicted: boolean
  startCursor: number
  timer: NodeJS.Timeout | null
}

export interface TerminalOutputEventCoalescerOptions {
  delayMs?: number
  maximumBatchLength?: number
  onFlush: (event: TerminalOutputEvent) => void
}

function haveSameRecipients(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  return left.every((clientId, index) => clientId === right[index])
}

export class TerminalOutputEventCoalescer {
  private readonly delayMs: number
  private readonly maximumBatchLength: number
  private readonly onFlush: (event: TerminalOutputEvent) => void
  private readonly pendingBySessionId = new Map<string, PendingTerminalOutputEvent>()

  constructor(options: TerminalOutputEventCoalescerOptions) {
    this.delayMs = Math.max(0, Math.floor(options.delayMs ?? TERMINAL_OUTPUT_BATCH_DELAY_MS))
    this.maximumBatchLength = Math.max(1, Math.floor(
      options.maximumBatchLength ?? TERMINAL_OUTPUT_BATCH_MAX_LENGTH,
    ))
    this.onFlush = options.onFlush
  }

  push(event: TerminalOutputEvent) {
    const brokerSessionId = event.output.brokerSessionId
    let pending = this.pendingBySessionId.get(brokerSessionId)

    if (pending && !haveSameRecipients(pending.clientIds, event.clientIds)) {
      this.flush(brokerSessionId)
      pending = undefined
    }

    if (!pending) {
      pending = {
        clientIds: [...event.clientIds],
        chunks: [],
        endCursor: event.output.endCursor,
        legacySessionId: event.legacySessionId,
        length: 0,
        outputEvicted: event.output.outputEvicted,
        startCursor: event.output.startCursor,
        timer: null,
      }
      this.pendingBySessionId.set(brokerSessionId, pending)
    }

    pending.chunks.push(event.output.data)
    pending.length += event.output.data.length
    pending.endCursor = event.output.endCursor
    pending.outputEvicted ||= event.output.outputEvicted

    if (pending.length >= this.maximumBatchLength || this.delayMs === 0) {
      this.flush(brokerSessionId)
      return
    }

    if (!pending.timer) {
      pending.timer = setTimeout(() => this.flush(brokerSessionId), this.delayMs)
      pending.timer.unref()
    }
  }

  flush(brokerSessionId: string) {
    const pending = this.pendingBySessionId.get(brokerSessionId)
    if (!pending) return
    this.pendingBySessionId.delete(brokerSessionId)
    if (pending.timer) clearTimeout(pending.timer)

    this.onFlush({
      clientIds: pending.clientIds,
      legacySessionId: pending.legacySessionId,
      output: {
        brokerSessionId,
        data: pending.chunks.join(''),
        endCursor: pending.endCursor,
        outputEvicted: pending.outputEvicted,
        startCursor: pending.startCursor,
      },
      type: 'terminal_output',
    })
  }

  flushAll() {
    for (const brokerSessionId of [...this.pendingBySessionId.keys()]) {
      this.flush(brokerSessionId)
    }
  }

  discard(brokerSessionId: string) {
    const pending = this.pendingBySessionId.get(brokerSessionId)
    if (!pending) return
    this.pendingBySessionId.delete(brokerSessionId)
    if (pending.timer) clearTimeout(pending.timer)
  }
}
