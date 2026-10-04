import assert from 'node:assert/strict'
import test from 'node:test'
import { expandChatMentions } from '../src/lib/chatMentions'
import { restoreChatComposerDraft } from '../src/lib/chatComposerDraft'

test('restoreChatComposerDraft returns visible mention text with a resendable path map', () => {
  const storedContent =
    '[[read_file:electron/chat/shared/prompts/mode/shared/tooling.mdl]] how can we improve that instruction?'

  const restoredDraft = restoreChatComposerDraft(storedContent)

  assert.equal(restoredDraft.value, '@tooling.mdl how can we improve that instruction?')
  assert.equal(
    restoredDraft.mentionPathMap.get('tooling.mdl'),
    'read_file:electron/chat/shared/prompts/mode/shared/tooling.mdl',
  )
  assert.equal(expandChatMentions(restoredDraft.value, restoredDraft.mentionPathMap), storedContent)
})

test('restoreChatComposerDraft keeps a persisted Kanban title instead of exposing its card id', () => {
  const storedContent = 'Please fix [[kanban:ebaf1f26-ca68-4a4f-838f-c937033eb1ad]]'
  const persistedMentionPathMap = {
    'Fix chat mention rendering': 'kanban:ebaf1f26-ca68-4a4f-838f-c937033eb1ad',
  }

  const restoredDraft = restoreChatComposerDraft(storedContent, persistedMentionPathMap)

  assert.equal(restoredDraft.value, 'Please fix @Fix chat mention rendering')
  assert.equal(
    expandChatMentions(restoredDraft.value, restoredDraft.mentionPathMap),
    storedContent,
  )
})

test('virtual alias mentions round-trip between compact UI labels and model-facing aliases', () => {
  const storedContent =
    'Compare @workspace/project1/src/App.tsx with @attachments/spec.pdf and @skills/pdfs/'
  const persistedMentionPathMap = {
    'App.tsx': '@workspace/project1/src/App.tsx',
    'spec.pdf': '@attachments/spec.pdf',
    pdfs: '@skills/pdfs/',
  }

  const restoredDraft = restoreChatComposerDraft(storedContent, persistedMentionPathMap)

  assert.equal(restoredDraft.value, 'Compare @App.tsx with @spec.pdf and @pdfs')
  assert.equal(
    expandChatMentions(restoredDraft.value, restoredDraft.mentionPathMap),
    storedContent,
  )
})
