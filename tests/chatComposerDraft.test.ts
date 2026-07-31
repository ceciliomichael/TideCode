import assert from 'node:assert/strict'
import test from 'node:test'
import { expandChatMentions } from '../src/lib/chatMentions'
import { restoreChatComposerDraft } from '../src/lib/chatComposerDraft'

test('restoreChatComposerDraft returns visible mention text with a resendable path map', () => {
  const storedContent =
    '[[read:electron/chat/shared/prompts/mode/shared/tooling.mdl]] how can we improve that instruction?'

  const restoredDraft = restoreChatComposerDraft(storedContent)

  assert.equal(restoredDraft.value, '@tooling.mdl how can we improve that instruction?')
  assert.equal(
    restoredDraft.mentionPathMap.get('tooling.mdl'),
    'read:electron/chat/shared/prompts/mode/shared/tooling.mdl',
  )
  assert.equal(expandChatMentions(restoredDraft.value, restoredDraft.mentionPathMap), storedContent)
})
