import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolInvocationDeltaCoalescer } from '../src/hooks/toolInvocationDeltaCoalescer'

test('tool invocation delta coalescer keeps only the latest pending value per invocation', () => {
  const consumed: Array<{ invocationId: string; argumentsText: string; toolName: string }> = []
  const coalescer = new ToolInvocationDeltaCoalescer((invocationId, value) => {
    consumed.push({ invocationId, ...value })
  }, 60_000)

  coalescer.enqueue('tool-1', { argumentsText: '{', toolName: 'read' })
  coalescer.enqueue('tool-1', { argumentsText: '{"path":"README.md"}', toolName: 'read' })

  assert.equal(consumed.length, 0)
  coalescer.flush()
  assert.deepEqual(consumed, [
    { invocationId: 'tool-1', argumentsText: '{"path":"README.md"}', toolName: 'read' },
  ])
})

test('tool invocation delta coalescer preserves independent invocation updates', () => {
  const consumed: string[] = []
  const coalescer = new ToolInvocationDeltaCoalescer((invocationId, value) => {
    consumed.push(`${invocationId}:${value.argumentsText}`)
  }, 60_000)

  coalescer.enqueue('tool-1', { argumentsText: 'one', toolName: 'read' })
  coalescer.enqueue('tool-2', { argumentsText: 'two', toolName: 'write' })
  coalescer.flush()

  assert.deepEqual(consumed, ['tool-1:one', 'tool-2:two'])
})
