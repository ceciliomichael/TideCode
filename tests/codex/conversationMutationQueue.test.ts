import assert from 'node:assert/strict'
import test from 'node:test'
import { runConversationMutation } from '../../electron/history/conversationMutationQueue'

test('conversation mutations run one at a time for the same conversation', async () => {
  const events: string[] = []
  let releaseFirst: (() => void) | null = null
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const first = runConversationMutation('conversation-queue-test', async () => {
    events.push('first:start')
    await firstCanFinish
    events.push('first:end')
    return 'first'
  })
  const second = runConversationMutation('conversation-queue-test', async () => {
    events.push('second:start')
    events.push('second:end')
    return 'second'
  })

  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first:start'])

  releaseFirst?.()
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('a failed mutation releases the queue for the next mutation', async () => {
  await assert.rejects(
    runConversationMutation('conversation-queue-recovery-test', async () => {
      throw new Error('expected mutation failure')
    }),
    /expected mutation failure/,
  )

  assert.equal(
    await runConversationMutation('conversation-queue-recovery-test', async () => 'recovered'),
    'recovered',
  )
})
