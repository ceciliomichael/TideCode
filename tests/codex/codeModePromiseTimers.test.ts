import test from 'node:test'
import assert from 'node:assert/strict'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'

const registry = {
  entries: [],
  get: () => undefined,
  search: () => [],
}

test('native Promise resolvers, timer callbacks and String conversion work in Code Mode', async () => {
  const executor = new CodeModeExecutor(registry)
  try {
    const result = await executor.run('await new Promise(resolve => setTimeout(resolve, 5)); const a = await new Promise(resolve => setTimeout(resolve, 5, 42)); return await Promise.all([String(a), Promise.resolve(2)])')
    assert.equal(result.status, 'success', String(result.error))
    assert.deepEqual(result.output, ['42', 2])
    const invalid = await executor.run('setTimeout(() => 1, 31000)', { limits: { timeoutMs: 1000 } })
    assert.equal(invalid.status, 'error')
    assert.match(String(invalid.error), /execution limit/)
  } finally {
    await executor.dispose()
  }
})
