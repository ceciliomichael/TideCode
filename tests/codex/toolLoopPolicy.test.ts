import assert from 'node:assert/strict'
import test from 'node:test'
import { continueToolLoopUntilModelStops } from '../../electron/chat/shared/toolLoopPolicy'

test('interactive tool loop never stops because of an artificial step count', async () => {
  const shouldStop = await continueToolLoopUntilModelStops({
    steps: Array.from({ length: 100_000 }, () => ({}) as never),
  })

  assert.equal(shouldStop, false)
})
