import type { TerminalBrokerOutputSlice } from '../../../src/types/chat'

export const DEFAULT_TERMINAL_BROKER_OUTPUT_LIMIT = 300_000

interface RetainedOutputChunk {
  data: string
  startCursor: number
}

const CHUNK_COMPACTION_THRESHOLD = 1_024
const PARTIAL_CHUNK_COPY_THRESHOLD = 64 * 1_024

export class TerminalBrokerOutputStore {
  private chunks: RetainedOutputChunk[] = []
  private headIndex = 0
  private headOffset = 0
  private retainedLength = 0
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

    if (chunk.length >= this.maximumLength) {
      const retainedData = chunk.slice(-this.maximumLength)
      this.chunks = [{
        data: retainedData,
        startCursor: this.endCursor - retainedData.length,
      }]
      this.headIndex = 0
      this.headOffset = 0
      this.retainedLength = retainedData.length
      this.startCursor = this.endCursor - retainedData.length
    } else {
      this.chunks.push({ data: chunk, startCursor: chunkStartCursor })
      this.retainedLength += chunk.length
      this.trimToMaximumLength()
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
      data: this.readRetainedData(effectiveCursor),
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
    const retainedData = restoredData.slice(-this.maximumLength)

    this.endCursor = input.endCursor
    this.startCursor = this.endCursor - retainedData.length
    this.retainedLength = retainedData.length
    this.headIndex = 0
    this.headOffset = 0
    this.chunks = retainedData
      ? [{ data: retainedData, startCursor: this.startCursor }]
      : []
  }

  get cursors() {
    return { endCursor: this.endCursor, startCursor: this.startCursor }
  }

  get retainedData() {
    return this.readRetainedData(this.startCursor)
  }

  private trimToMaximumLength() {
    let overflow = this.retainedLength - this.maximumLength
    if (overflow <= 0) return

    while (overflow > 0 && this.headIndex < this.chunks.length) {
      const head = this.chunks[this.headIndex]
      if (!head) break
      const availableLength = head.data.length - this.headOffset

      if (overflow < availableLength) {
        this.headOffset += overflow
        this.retainedLength -= overflow
        this.startCursor += overflow
        overflow = 0
        this.compactPartialHeadChunk()
        break
      }

      overflow -= availableLength
      this.retainedLength -= availableLength
      this.startCursor += availableLength
      this.headIndex += 1
      this.headOffset = 0
    }

    this.compactConsumedChunks()
  }

  private compactPartialHeadChunk() {
    const head = this.chunks[this.headIndex]
    if (!head || this.headOffset <= 0) return
    if (
      this.headOffset < PARTIAL_CHUNK_COPY_THRESHOLD
      && this.headOffset < head.data.length / 2
    ) {
      return
    }

    this.chunks[this.headIndex] = {
      data: head.data.slice(this.headOffset),
      startCursor: head.startCursor + this.headOffset,
    }
    this.headOffset = 0
  }

  private compactConsumedChunks() {
    if (
      this.headIndex < CHUNK_COMPACTION_THRESHOLD
      || this.headIndex * 2 < this.chunks.length
    ) {
      return
    }
    this.chunks = this.chunks.slice(this.headIndex)
    this.headIndex = 0
  }

  private readRetainedData(cursor: number) {
    if (cursor >= this.endCursor || this.headIndex >= this.chunks.length) return ''

    const chunkIndex = this.findChunkIndex(cursor)
    const firstChunk = this.chunks[chunkIndex]
    if (!firstChunk) return ''

    const firstOffset = Math.max(
      chunkIndex === this.headIndex ? this.headOffset : 0,
      cursor - firstChunk.startCursor,
    )
    if (chunkIndex === this.chunks.length - 1) {
      return firstChunk.data.slice(firstOffset)
    }

    const parts = [firstChunk.data.slice(firstOffset)]
    for (let index = chunkIndex + 1; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index]
      if (chunk) parts.push(chunk.data)
    }
    return parts.join('')
  }

  private findChunkIndex(cursor: number) {
    let low = this.headIndex
    let high = this.chunks.length - 1
    let result = this.headIndex

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const chunk = this.chunks[middle]
      if (!chunk) break
      if (chunk.startCursor <= cursor) {
        result = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return result
  }
}
