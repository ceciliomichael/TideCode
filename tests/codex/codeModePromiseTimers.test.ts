import test from 'node:test'
import assert from 'node:assert/strict'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'

const registry = {
  entries: [],
  get: () => undefined,
  search: () => [],
}

test('Promise construction and timers work in restricted Code Mode', async () => {
  const executor = new CodeModeExecutor(registry)
  try {
    const result = await executor.run('const a = await new Promise(resolve => setTimeout(() => resolve(42), 5)); return await Promise.all([a, Promise.resolve(2)])')
    assert.equal(result.status, 'success', String(result.error))
    assert.deepEqual(result.output, [42, 2])
    const invalid = await executor.run('setTimeout(() => 1, 31000)')
    assert.equal(invalid.status, 'error')
    assert.match(String(invalid.error), /30000ms/)
  } finally {
    await executor.dispose()
  }
})
