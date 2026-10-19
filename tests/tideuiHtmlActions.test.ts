import assert from 'node:assert/strict'
import test from 'node:test'
import { executeHtmlAction } from '../src/lib/tideui/htmlActions'

test('HTML actions use the native send, draft and clipboard callbacks', async () => {
  const sent: string[] = []
  const drafted: string[] = []
  const copied: string[] = []
  const actions = {
    onSend: (value: string) => { sent.push(value); return true },
    onDraft: (value: string) => { drafted.push(value) },
  }
  const copy = async (value: string) => { copied.push(value); return true }
  for (const kind of ['send', 'draft', 'copy']) {
    assert.deepEqual(await executeHtmlAction({ kind, value: kind }, actions, false, copy), { ok: true })
  }
  assert.deepEqual(sent, ['send'])
  assert.deepEqual(drafted, ['draft'])
  assert.deepEqual(copied, ['copy'])
})

test('HTML actions reject invalid payloads and streaming requests without running callbacks', async () => {
  let calls = 0
  const actions = { onSend: () => { calls++; return true } }
  const copy = async () => { calls++; return true }
  for (const request of [null, {}, { kind: 'terminal', value: 'run' }, { kind: 'send', value: {} }, { kind: 'send', value: '' }, { kind: 'send', value: 'x'.repeat(4001) }, { kind: 'open', value: 'javascript:alert(1)' }, { kind: 'open', value: 'file:///private' }]) {
    assert.equal((await executeHtmlAction(request, actions, false, copy)).ok, false)
  }
  for (const kind of ['send', 'draft', 'copy', 'open']) {
    assert.equal((await executeHtmlAction({ kind, value: 'https://example.com' }, actions, true, copy)).ok, false)
  }
  assert.equal(calls, 0)
})

test('HTML action failures return truthful results rather than claiming success', async () => {
  const copy = async () => false
  for (const actions of [{}, { onSend: () => false }, { onSend: () => { throw new Error('Unavailable') } }]) {
    const result = await executeHtmlAction({ kind: 'send', value: 'Question' }, actions, false, copy)
    assert.equal(result.ok, false)
    assert.ok(result.error)
  }
})
