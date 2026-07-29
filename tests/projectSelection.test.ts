import assert from 'node:assert/strict'
import test from 'node:test'
import { ALL_PROJECTS_FILTER_ID, CHATS_PROJECT_FILTER_ID } from '../src/components/sidebar/sidebarProjectThreads'
import { resolveProjectSwitchTarget } from '../src/lib/projectSelectionUtils'
import type { ConversationGroupPreview } from '../src/types/chat'

const mockGroups: ConversationGroupPreview[] = [
  {
    folder: {
      conversationCount: 1,
      id: 'project-1',
      name: 'Project One',
      path: '/projects/p1',
    },
    conversations: [
      {
        folderId: 'project-1',
        id: 'conv-p1-1',
        isPinned: false,
        preview: 'hello',
        title: 'Project 1 Chat',
        updatedAt: 100,
        updatedAtLabel: '100',
      },
    ],
  },
  {
    folder: {
      conversationCount: 1,
      id: 'project-2',
      name: 'Project Two',
      path: '/projects/p2',
    },
    conversations: [
      {
        folderId: 'project-2',
        id: 'conv-p2-1',
        isPinned: false,
        preview: 'world',
        title: 'Project 2 Chat',
        updatedAt: 200,
        updatedAtLabel: '200',
      },
    ],
  },
  {
    folder: {
      conversationCount: 1,
      id: null,
      name: 'Chats',
      path: null,
    },
    conversations: [
      {
        folderId: null,
        id: 'conv-chats-1',
        isPinned: false,
        preview: 'unassigned',
        title: 'Chats Thread',
        updatedAt: 300,
        updatedAtLabel: '300',
      },
    ],
  },
]

test('switching to All Projects preserves active thread when a conversation is active', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: ALL_PROJECTS_FILTER_ID,
  })

  assert.deepEqual(result, { type: 'preserve_active_thread' })
})

test('switching to All Projects preserves active thread even when on a draft thread (null activeConversationId)', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: null,
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: ALL_PROJECTS_FILTER_ID,
  })

  assert.deepEqual(result, { type: 'preserve_active_thread' })
})

test('switching from Project 1 to Project 2 switches to Project 2 thread', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: 'project-2',
  })

  assert.deepEqual(result, { type: 'switch_to_conversation', conversationId: 'conv-p2-1' })
})

test('switching to same project preserves active thread', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: 'project-1',
  })

  assert.deepEqual(result, { type: 'preserve_active_thread' })
})

test('switching to empty project creates new conversation for that project', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: 'empty-project-id',
  })

  assert.deepEqual(result, { type: 'create_new_conversation', folderId: 'empty-project-id' })
})

test('switching to Chats selects Chats conversation', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: CHATS_PROJECT_FILTER_ID,
  })

  assert.deepEqual(result, { type: 'switch_to_conversation', conversationId: 'conv-chats-1' })
})
