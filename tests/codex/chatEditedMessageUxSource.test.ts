import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('edited sends reuse the existing message id instead of rolling the bubble away first', async () => {
  const source = await fs.readFile(new URL('../../src/hooks/useChatSendActions.ts', import.meta.url), 'utf8')
  const editedSendStart = source.indexOf('const sendEditedMessage = useCallback(')
  const editedSendEnd = source.indexOf('const abortStreamingResponse = useCallback(', editedSendStart)

  assert.notEqual(editedSendStart, -1)
  assert.notEqual(editedSendEnd, -1)

  const editedSendSource = source.slice(editedSendStart, editedSendEnd)
  assert.match(editedSendSource, /targetEditMessageId:\s*editingMessageId/u)
  assert.doesNotMatch(
    editedSendSource,
    /await rollbackConversationBeforeUserMessage\(conversationId, editingMessageId\)/u,
  )
})
