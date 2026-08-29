import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('Kanban mention display labels survive composer send and sent-message rendering', async () => {
  const [chatInput, messageList, userMessage, sendActions] = await Promise.all([
    fs.readFile(new URL('../../src/components/ChatInput.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/components/MessageList.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/components/UserMessage.tsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/hooks/useChatSendActions.ts', import.meta.url), 'utf8'),
  ])

  assert.match(chatInput, /new Map\(mentionMenu\.mentionPathMapRef\.current\)/u)
  assert.match(chatInput, /callback\(mentionMenu\.expandValueForSend\(value\), attachments, mentionPathMap\)/u)
  assert.match(sendActions, /mentionPathMap: serializeChatMentionPathMap\(options\?\.mentionPathMap\)/u)
  assert.match(messageList, /mentionPathMap=\{message\.mentionPathMap\}/u)
  assert.match(userMessage, /mentionPathMap=\{renderedMentionPathMap\}/u)
})

test('Kanban mention chips do not expose their internal id in a hover tooltip', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/chat/ChatMentionText.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /if \(isKanban\) \{/u)
  const kanbanBranch = source.slice(source.indexOf('if (isKanban) {'), source.indexOf('if (isRendered) {'))
  assert.doesNotMatch(kanbanBranch, /<Tooltip/u)
  assert.doesNotMatch(kanbanBranch, /content=\{segment\.path/u)
})
