import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
} from '../src/components/sidebar/sidebarProjectThreads'
import {
  findFolderIdForConversation,
  resolveProjectFilterDraftFolderId,
  resolveProjectSwitchTarget,
  shouldResetProjectFilterToAllProjects,
} from '../src/lib/projectSelectionUtils'
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

test('switching from Project 1 to Project 2 creates a new thread in Project 2', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: 'project-2',
  })

  assert.deepEqual(result, { type: 'create_new_conversation', folderId: 'project-2' })
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

test('switching to Chats creates a new conversation', () => {
  const result = resolveProjectSwitchTarget({
    activeConversationId: 'conv-p1-1',
    conversationGroups: mockGroups,
    currentSelectedFolderId: 'project-1',
    projectId: CHATS_PROJECT_FILTER_ID,
  })

  assert.deepEqual(result, { type: 'create_new_conversation', folderId: null })
})

test('switching to Archived only changes the filter and keeps the active chat open', () => {
  assert.deepEqual(
    resolveProjectSwitchTarget({
      activeConversationId: 'conversation-1',
      conversationGroups: [],
      currentSelectedFolderId: null,
      projectId: ARCHIVED_PROJECT_FILTER_ID,
    }),
    { type: 'preserve_active_thread' },
  )
})

test('project filters resolve to the draft folder used by an empty chat', () => {
  assert.equal(resolveProjectFilterDraftFolderId('project-1'), 'project-1')
  assert.equal(resolveProjectFilterDraftFolderId(CHATS_PROJECT_FILTER_ID), null)
  assert.equal(resolveProjectFilterDraftFolderId(ALL_PROJECTS_FILTER_ID), undefined)
  assert.equal(resolveProjectFilterDraftFolderId(ARCHIVED_PROJECT_FILTER_ID), undefined)
})

test('shouldResetProjectFilterToAllProjects returns true only when selected filter does not match active thread project', () => {
  // Matching project filter: do not reset
  assert.equal(shouldResetProjectFilterToAllProjects('project-1', 'project-1'), false)
  // All projects filter: do not reset
  assert.equal(shouldResetProjectFilterToAllProjects(ALL_PROJECTS_FILTER_ID, 'project-1'), false)
  assert.equal(shouldResetProjectFilterToAllProjects(ALL_PROJECTS_FILTER_ID, null), false)
  // Matching Chats filter: do not reset
  assert.equal(shouldResetProjectFilterToAllProjects(CHATS_PROJECT_FILTER_ID, null), false)

  // Mismatched project filter: reset to All projects
  assert.equal(shouldResetProjectFilterToAllProjects('project-1', 'project-2'), true)
  assert.equal(shouldResetProjectFilterToAllProjects('project-1', null), true)
  assert.equal(shouldResetProjectFilterToAllProjects(CHATS_PROJECT_FILTER_ID, 'project-1'), true)
})

test('findFolderIdForConversation returns folderId for known conversations', () => {
  assert.equal(findFolderIdForConversation(mockGroups, 'conv-p1-1'), 'project-1')
  assert.equal(findFolderIdForConversation(mockGroups, 'conv-p2-1'), 'project-2')
  assert.equal(findFolderIdForConversation(mockGroups, 'conv-chats-1'), null)
  assert.equal(findFolderIdForConversation(mockGroups, 'unknown-id'), undefined)
})


