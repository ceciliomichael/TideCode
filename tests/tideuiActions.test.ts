import assert from 'node:assert/strict'
import test from 'node:test'
import { executeTideAction, validateTideAction } from '../src/lib/tideui/actions'

test('TideUI send action invokes the real user-message callback once', async () => {
  const sent: string[] = []
  const didSend = await executeTideAction({kind:'send',value:'Review this file'}, {
    onSend: async text => { sent.push(text); return true },
  }, async () => false)
  assert.equal(didSend, true)
  assert.deepEqual(sent, ['Review this file'])
})

test('Rejected TideUI sends are not shown as accepted', async () => {
  assert.equal(await executeTideAction({kind:'send',value:'Request'}, {onSend: () => false}, async () => true), false)
  assert.equal(await executeTideAction({kind:'send',value:'Request'}, {}, async () => true), false)
})

test('TideUI draft and copy actions are distinct from send', async () => {
  let draft = ''
  let copied = ''
  const callbacks = { onDraft: (value: string) => { draft = value }, onSend: () => false }
  assert.equal(await executeTideAction({kind:'draft',value:'User text'},callbacks,async () => false),true)
  assert.equal(await executeTideAction({kind:'copy',value:'npm install'},callbacks,async value => {copied=value;return true}),true)
  assert.equal(draft, 'User text')
  assert.equal(copied, 'npm install')
})

test('TideUI action rejects empty, oversized, unsafe URL payloads', () => {
  assert.ok(validateTideAction({kind:'send',value:' '}))
  assert.ok(validateTideAction({kind:'send',value:'x'.repeat(4001)}))
  assert.ok(validateTideAction({kind:'open',value:'file:///private'}))
  assert.equal(validateTideAction({kind:'open',value:'https://example.com'}),null)
})

test('Embedded native actions await host results and never bypass supplied copy/open callbacks', async () => {
  let fallbackCopies = 0
  const copy = async () => { fallbackCopies++; return true }
  const actions = {
    onDraft: async () => false,
    onCopy: async () => false,
    onOpen: async () => false,
  }
  for (const kind of ['draft', 'copy', 'open'] as const) {
    assert.equal(await executeTideAction({ kind, value: 'https://example.com' }, actions, copy), false)
  }
  assert.equal(fallbackCopies, 0)
})
