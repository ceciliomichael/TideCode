import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_PROJECTS_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
  buildSidebarProjectOptions,
  buildSidebarThreadRows,
  resolveSidebarProjectFilter,
} from '../src/components/sidebar/sidebarProjectThreads'
import type { ConversationGroupPreview, ConversationPreview } from '../src/types/chat'

function createConversation(
  id: string,
  folderId: string | null,
  updatedAt: number,
  isPinned = false,
  isActive = false,
): ConversationPreview {
  return {
    folderId,
    id,
    isActive,
    isPinned,
    preview: '',
    title: id,
    updatedAt,
    updatedAtLabel: `${updatedAt}`,
  }
}

const projectOneConversation = createConversation('project-one-chat', 'project-one', 100)
const projectTwoConversation = createConversation('project-two-chat', 'project-two', 300)
const pinnedProjectOneConversation = createConversation('pinned-project-one-chat', 'project-one', 200, true)
const unassignedConversation = createConversation('unassigned-chat', null, 50)

const groups: ConversationGroupPreview[] = [
  {
    folder: {
      conversationCount: 1,
      id: 'pinned',
      name: 'Pinned',
      path: null,
    },
    conversations: [pinnedProjectOneConversation],
  },
  {
    folder: {
      conversationCount: 1,
      id: 'project-one',
      name: 'Movie tracker',
      path: 'C:/projects/movie-tracker',
    },
    conversations: [projectOneConversation],
  },
  {
    folder: {
      conversationCount: 1,
      id: 'project-two',
      name: 'Data science',
      path: 'C:/projects/data-science',
    },
    conversations: [projectTwoConversation],
  },
  {
    folder: {
      conversationCount: 1,
      id: null,
      name: 'Chats',
      path: null,
    },
    conversations: [unassignedConversation],
  },
]

test('buildSidebarProjectOptions returns projects in persisted order and counts pinned threads', () => {
  assert.deepEqual(buildSidebarProjectOptions(groups), [
    {
      conversationCount: 2,
      id: 'project-one',
      name: 'Movie tracker',
    },
    {
      conversationCount: 1,
      id: 'project-two',
      name: 'Data science',
    },
  ])
})

test('all-projects rows are globally recent and include workspace labels', () => {
  assert.deepEqual(
    buildSidebarThreadRows(groups, ALL_PROJECTS_FILTER_ID).map((row) => ({
      id: row.conversation.id,
      workspaceName: row.workspaceName,
    })),
    [
      { id: 'project-two-chat', workspaceName: 'Data science' },
      { id: 'pinned-project-one-chat', workspaceName: 'Movie tracker' },
      { id: 'project-one-chat', workspaceName: 'Movie tracker' },
      { id: 'unassigned-chat', workspaceName: 'Chats' },
    ],
  )
})

test('project rows include pinned and unpinned conversations without duplicates', () => {
  const duplicatedGroups = groups.map((group) =>
    group.folder.id === 'project-one'
      ? {
          ...group,
          conversations: [...group.conversations, pinnedProjectOneConversation],
        }
      : group,
  )

  assert.deepEqual(
    buildSidebarThreadRows(duplicatedGroups, 'project-one').map((row) => row.conversation.id),
    ['pinned-project-one-chat', 'project-one-chat'],
  )
})

test('thread search matches chat titles and workspace names without changing project scope', () => {
  assert.deepEqual(
    buildSidebarThreadRows(groups, ALL_PROJECTS_FILTER_ID, 'movie').map((row) => row.conversation.id),
    ['pinned-project-one-chat', 'project-one-chat'],
  )
  assert.deepEqual(
    buildSidebarThreadRows(groups, 'project-two', 'project-two-chat').map((row) => row.conversation.id),
    ['project-two-chat'],
  )
  assert.deepEqual(buildSidebarThreadRows(groups, 'project-one', 'data science'), [])
})

test('Chats filter returns only conversations without a project', () => {
  assert.deepEqual(
    buildSidebarThreadRows(groups, CHATS_PROJECT_FILTER_ID).map((row) => row.conversation.id),
    ['unassigned-chat'],
  )
})

test('resolveSidebarProjectFilter falls back to all projects after a project disappears', () => {
  const projects = buildSidebarProjectOptions(groups)

  assert.equal(resolveSidebarProjectFilter('project-two', projects), 'project-two')
  assert.equal(resolveSidebarProjectFilter(CHATS_PROJECT_FILTER_ID, projects), CHATS_PROJECT_FILTER_ID)
  assert.equal(resolveSidebarProjectFilter('removed-project', projects), ALL_PROJECTS_FILTER_ID)
})

test('resolveSidebarProjectFilter preserves selectedProjectId while history is loading', () => {
  assert.equal(resolveSidebarProjectFilter('project-two', [], true), 'project-two')
  assert.equal(resolveSidebarProjectFilter('custom-project-id', [], true), 'custom-project-id')
})

test('active conversation folder takes precedence over globally latest conversation when filtering all projects', () => {
  const projectOneOlderConv = createConversation('project-one-older', 'project-one', 500, false, false)
  const projectTwoActiveConv = createConversation('project-two-active', 'project-two', 100, false, true)

  const activeGroups: ConversationGroupPreview[] = [
    {
      folder: { conversationCount: 1, id: 'project-one', name: 'Movie tracker', path: 'C:/projects/movie-tracker' },
      conversations: [projectOneOlderConv],
    },
    {
      folder: { conversationCount: 1, id: 'project-two', name: 'Data science', path: 'C:/projects/data-science' },
      conversations: [projectTwoActiveConv],
    },
  ]

  const rows = buildSidebarThreadRows(activeGroups, ALL_PROJECTS_FILTER_ID)
  const activeRow = rows.find((r) => r.conversation.isActive)
  assert.equal(activeRow?.conversation.folderId, 'project-two')
})

