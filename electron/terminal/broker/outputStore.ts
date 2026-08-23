import type { TerminalBrokerOutputSlice } from '../../../src/types/chat'

export const DEFAULT_TERMINAL_BROKER_OUTPUT_LIMIT = 300_000

export class TerminalBrokerOutputStore {
  private data = ''
  private startCursor = 0
  private endCursor = 0

  constructor(private readonly maximumLength = DEFAULT_TERMINAL_BROKER_OUTPUT_LIMIT) {
    if (!Number.isInteger(maximumLength) || maximumLength <= 0) {
      throw new Error('Terminal broker output limit must be a positive integer.')
    }
  }

  append(brokerSessionId: string, chunk: string): TerminalBrokerOutputSlice {
    if (!chunk) return this.read(brokerSessionId, this.endCursor)

    const chunkStartCursor = this.endCursor
    this.endCursor += chunk.length
    this.data += chunk

    if (this.data.length > this.maximumLength) {
      const removedLength = this.data.length - this.maximumLength
      this.data = this.data.slice(removedLength)
      this.startCursor += removedLength
    }

    return {
      brokerSessionId,
      data: chunk,
      endCursor: this.endCursor,
      outputEvicted: chunkStartCursor < this.startCursor,
      startCursor: chunkStartCursor,
    }
  }

  read(brokerSessionId: string, requestedCursor = this.startCursor): TerminalBrokerOutputSlice {
    const normalizedCursor = Number.isFinite(requestedCursor)
      ? Math.max(0, Math.floor(requestedCursor))
      : this.startCursor
    const effectiveCursor = Math.max(this.startCursor, Math.min(normalizedCursor, this.endCursor))
    return {
      brokerSessionId,
      data: this.data.slice(effectiveCursor - this.startCursor),
      endCursor: this.endCursor,
      outputEvicted: normalizedCursor < this.startCursor,
      startCursor: effectiveCursor,
    }
  }

  restore(input: { data: string; endCursor: number; startCursor: number }) {
    if (input.startCursor < 0 || input.endCursor < input.startCursor) {
      throw new Error('Invalid terminal output cursor range.')
    }
    const expectedLength = input.endCursor - input.startCursor
    const restoredData = input.data.length > expectedLength
      ? input.data.slice(input.data.length - expectedLength)
      : input.data
    this.data = restoredData.slice(-this.maximumLength)
    this.endCursor = input.endCursor
    this.startCursor = this.endCursor - this.data.length
  }

  get cursors() {
    return { endCursor: this.endCursor, startCursor: this.startCursor }
  }

  get retainedData() {
    return this.data
  }
}
