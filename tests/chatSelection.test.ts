import assert from 'node:assert/strict'
import test from 'node:test'
import { readChatSelectionFromRefs, syncChatSelectionRefs } from '../src/lib/chatSelection'

test('a newly created draft is authoritative even when the previous thread was running', () => {
  const refs = {
    activeConversationIdRef: { current: 'running-thread' as string | null },
    selectedFolderIdRef: { current: 'project-a' as string | null },
  }

  syncChatSelectionRefs(refs, {
    activeConversationId: null,
    selectedFolderId: 'project-a',
  })

  assert.deepEqual(readChatSelectionFromRefs(refs), {
    activeConversationId: null,
    selectedFolderId: 'project-a',
  })
})

test('selection refs track a switched persisted thread and project together', () => {
  const refs = {
    activeConversationIdRef: { current: 'thread-a' as string | null },
    selectedFolderIdRef: { current: 'project-a' as string | null },
  }

  syncChatSelectionRefs(refs, {
    activeConversationId: 'thread-b',
    selectedFolderId: 'project-b',
  })

  assert.deepEqual(readChatSelectionFromRefs(refs), {
    activeConversationId: 'thread-b',
    selectedFolderId: 'project-b',
  })
})
