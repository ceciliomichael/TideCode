import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalBrokerEvent } from '../../src/types/chat'
import { TerminalOutputEventCoalescer } from '../../electron/terminal/broker/outputEventCoalescer'

type TerminalOutputEvent = Extract<TerminalBrokerEvent, { type: 'terminal_output' }>

function outputEvent(input: {
  clientIds?: string[]
  data: string
  endCursor: number
  startCursor: number
}): TerminalOutputEvent {
  return {
    clientIds: input.clientIds ?? ['desktop'],
    legacySessionId: 7,
    output: {
      brokerSessionId: 'session-1',
      data: input.data,
      endCursor: input.endCursor,
      outputEvicted: false,
      startCursor: input.startCursor,
    },
    type: 'terminal_output',
  }
}

test('terminal output events coalesce adjacent chunks without changing cursor order', () => {
  const emitted: TerminalOutputEvent[] = []
  const coalescer = new TerminalOutputEventCoalescer({
    delayMs: 60_000,
    maximumBatchLength: 1_024,
    onFlush: (event) => emitted.push(event),
  })

  coalescer.push(outputEvent({ data: 'ab', endCursor: 2, startCursor: 0 }))
  coalescer.push(outputEvent({ data: 'cd', endCursor: 4, startCursor: 2 }))
  assert.equal(emitted.length, 0)

  coalescer.flush('session-1')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0]?.output.data, 'abcd')
  assert.equal(emitted[0]?.output.startCursor, 0)
  assert.equal(emitted[0]?.output.endCursor, 4)
})

test('terminal output batching never crosses a recipient change', () => {
  const emitted: TerminalOutputEvent[] = []
  const coalescer = new TerminalOutputEventCoalescer({
    delayMs: 60_000,
    maximumBatchLength: 1_024,
    onFlush: (event) => emitted.push(event),
  })

  coalescer.push(outputEvent({ clientIds: ['first'], data: 'a', endCursor: 1, startCursor: 0 }))
  coalescer.push(outputEvent({ clientIds: ['second'], data: 'b', endCursor: 2, startCursor: 1 }))

  assert.equal(emitted.length, 1)
  assert.deepEqual(emitted[0]?.clientIds, ['first'])
  assert.equal(emitted[0]?.output.data, 'a')

  coalescer.flushAll()
  assert.equal(emitted.length, 2)
  assert.deepEqual(emitted[1]?.clientIds, ['second'])
  assert.equal(emitted[1]?.output.data, 'b')
})

test('terminal output batches flush immediately at the size threshold', () => {
  const emitted: TerminalOutputEvent[] = []
  const coalescer = new TerminalOutputEventCoalescer({
    delayMs: 60_000,
    maximumBatchLength: 4,
    onFlush: (event) => emitted.push(event),
  })

  coalescer.push(outputEvent({ data: 'ab', endCursor: 2, startCursor: 0 }))
  coalescer.push(outputEvent({ data: 'cd', endCursor: 4, startCursor: 2 }))

  assert.equal(emitted.length, 1)
  assert.equal(emitted[0]?.output.data, 'abcd')
})
