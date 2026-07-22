import assert from 'node:assert/strict'
import test from 'node:test'

function determineNextConversationAfterDeletion({
  activeConversationId,
  deletedConversationId,
  deletedConversationFolderId,
}: {
  activeConversationId: string | null
  deletedConversationId: string
  deletedConversationFolderId: string | null
}): { action: 'createInFolder'; folderId: string | null } | { action: 'noop' } {
  if (deletedConversationId !== activeConversationId) {
    return { action: 'noop' }
  }

  return {
    action: 'createInFolder',
    folderId: deletedConversationFolderId,
  }
}

test('determines that deleting non-active thread does not change active selection', () => {
  const result = determineNextConversationAfterDeletion({
    activeConversationId: 'thread-2',
    deletedConversationId: 'thread-1',
    deletedConversationFolderId: 'project-1',
  })

  assert.deepEqual(result, { action: 'noop' })
})

test('creates a new thread in the same project folder when deleting the active thread even if other threads exist', () => {
  const result = determineNextConversationAfterDeletion({
    activeConversationId: 'thread-1',
    deletedConversationId: 'thread-1',
    deletedConversationFolderId: 'project-1',
  })

  assert.deepEqual(result, {
    action: 'createInFolder',
    folderId: 'project-1',
  })
})
