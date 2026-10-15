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
  const optimisticCutoffIndex = editedSendSource.indexOf('beginOptimisticEditedPresentationImmediately(conversationId')
  const persistedReloadIndex = editedSendSource.indexOf('window.tidecodeHistory.getConversation(conversationId)')
  assert.ok(optimisticCutoffIndex >= 0)
  assert.ok(persistedReloadIndex > optimisticCutoffIndex)
  assert.doesNotMatch(
    editedSendSource,
    /await rollbackConversationBeforeUserMessage\(conversationId, editingMessageId\)/u,
  )
})

test('revert hides the later branch before checkpoint work begins', async () => {
  const source = await fs.readFile(new URL('../../src/hooks/useChatSendActions.ts', import.meta.url), 'utf8')
  const revertStart = source.indexOf('const revertUserMessage = useCallback(')
  const revertEnd = source.indexOf('return {', revertStart)

  assert.notEqual(revertStart, -1)
  assert.notEqual(revertEnd, -1)

  const revertSource = source.slice(revertStart, revertEnd)
  const optimisticCutoffIndex = revertSource.indexOf('beginRevertPresentationImmediately(conversationId, optimisticRevertMessageId)')
  const prepareRevertIndex = revertSource.indexOf('await prepareMessageRevert(conversationId, messageId')
  assert.ok(optimisticCutoffIndex >= 0)
  assert.ok(prepareRevertIndex > optimisticCutoffIndex)
})
