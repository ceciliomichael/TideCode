import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
  UNASSIGNED_WORKSPACE_NAME,
  buildSidebarProjectOptions,
  buildSidebarThreadRows,
  resolveLatestThreadProject,
  resolveSidebarProjectFilter,
} from '../src/components/sidebar/sidebarProjectThreads'
import type { ConversationGroupPreview, ConversationPreview } from '../src/types/chat'

function createConversation(
  id: string,
  folderId: string | null,
  updatedAt: number,
  isPinned = false,
  isActive = false,
  isArchived = false,
): ConversationPreview {
  return {
    folderId,
    id,
    isActive,
    isArchived,
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
const archivedProjectOneConversation = createConversation('archived-project-one-chat', 'project-one', 400, false, false, true)

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
  {
    folder: {
      conversationCount: 1,
      id: 'archived',
      name: 'Archived',
      path: null,
    },
    conversations: [archivedProjectOneConversation],
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

test('Archived filter returns only archived conversations and keeps their project context', () => {
  assert.deepEqual(
    buildSidebarThreadRows(groups, ARCHIVED_PROJECT_FILTER_ID).map((row) => ({
      id: row.conversation.id,
      workspaceName: row.workspaceName,
    })),
    [{ id: 'archived-project-one-chat', workspaceName: 'Movie tracker' }],
  )
  assert.deepEqual(buildSidebarThreadRows(groups, ALL_PROJECTS_FILTER_ID).map((row) => row.conversation.id), [
    'project-two-chat',
    'pinned-project-one-chat',
    'project-one-chat',
    'unassigned-chat',
  ])
})

test('resolveSidebarProjectFilter falls back to all projects after a project disappears', () => {
  const projects = buildSidebarProjectOptions(groups)

  assert.equal(resolveSidebarProjectFilter('project-two', projects), 'project-two')
  assert.equal(resolveSidebarProjectFilter(CHATS_PROJECT_FILTER_ID, projects), CHATS_PROJECT_FILTER_ID)
  assert.equal(resolveSidebarProjectFilter(ARCHIVED_PROJECT_FILTER_ID, projects), ARCHIVED_PROJECT_FILTER_ID)
  assert.equal(resolveSidebarProjectFilter('removed-project', projects), ALL_PROJECTS_FILTER_ID)
})

test('resolveSidebarProjectFilter preserves selectedProjectId while history is loading', () => {
  assert.equal(resolveSidebarProjectFilter('project-two', [], true), 'project-two')
  assert.equal(resolveSidebarProjectFilter('custom-project-id', [], true), 'custom-project-id')
})

test('resolveSidebarProjectFilter falls back to all projects when the archived filter is selected without archived conversations', () => {
  const projects = buildSidebarProjectOptions(groups)

  assert.equal(resolveSidebarProjectFilter(ARCHIVED_PROJECT_FILTER_ID, projects, false, true), ARCHIVED_PROJECT_FILTER_ID)
  assert.equal(resolveSidebarProjectFilter(ARCHIVED_PROJECT_FILTER_ID, projects, false, false), ALL_PROJECTS_FILTER_ID)
  assert.equal(resolveSidebarProjectFilter(ALL_PROJECTS_FILTER_ID, projects, false, false), ALL_PROJECTS_FILTER_ID)
  assert.equal(resolveSidebarProjectFilter('project-two', projects, false, false), 'project-two')
  assert.equal(resolveSidebarProjectFilter(ARCHIVED_PROJECT_FILTER_ID, projects, true, false), ARCHIVED_PROJECT_FILTER_ID)
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

function buildLatestThreadProjectOptions(
  conversationGroups: ConversationGroupPreview[],
): ReturnType<typeof buildSidebarProjectOptions> {
  const projectOptions = buildSidebarProjectOptions(conversationGroups)
  return [{ conversationCount: 0, id: CHATS_PROJECT_FILTER_ID, name: UNASSIGNED_WORKSPACE_NAME }, ...projectOptions]
}

function resolveLatestThreadProjectFor(
  conversationGroups: ConversationGroupPreview[],
  selectedProjectId: string,
) {
  const threadRows = buildSidebarThreadRows(conversationGroups, ALL_PROJECTS_FILTER_ID)
  return resolveLatestThreadProject(selectedProjectId, threadRows, conversationGroups, buildLatestThreadProjectOptions(conversationGroups))
}

test('resolveLatestThreadProject resolves to Chats when the Chats group is selected even if the globally latest thread is in a project', () => {
  // Regression: the user was in a project, started a new thread in Chats (draft, no active
  // conversation, Chats group selected), and the modal must not fall back to the globally
  // latest thread's project.
  const latestProjectConversation = createConversation('project-one-latest', 'project-one', 500)
  const chatsDraftContextGroups: ConversationGroupPreview[] = [
    {
      folder: {
        conversationCount: 1,
        id: 'project-one',
        isSelected: false,
        name: 'Movie tracker',
        path: 'C:/projects/movie-tracker',
      },
      conversations: [latestProjectConversation],
    },
    {
      folder: { conversationCount: 0, id: null, isSelected: true, name: 'Chats', path: null },
      conversations: [],
    },
  ]

  const result = resolveLatestThreadProjectFor(chatsDraftContextGroups, ALL_PROJECTS_FILTER_ID)

  assert.equal(result?.id, CHATS_PROJECT_FILTER_ID)
  assert.equal(result?.name, UNASSIGNED_WORKSPACE_NAME)
})

test('resolveLatestThreadProject uses the selected project group when a draft is open in it', () => {
  const groups: ConversationGroupPreview[] = [
    {
      folder: {
        conversationCount: 0,
        id: 'project-one',
        isSelected: true,
        name: 'Movie tracker',
        path: 'C:/projects/movie-tracker',
      },
      conversations: [],
    },
    {
      folder: { conversationCount: 1, id: null, isSelected: false, name: 'Chats', path: null },
      conversations: [createConversation('chats-latest', null, 500)],
    },
  ]

  const result = resolveLatestThreadProjectFor(groups, ALL_PROJECTS_FILTER_ID)

  assert.equal(result?.id, 'project-one')
})

test('resolveLatestThreadProject prefers the active conversation folder over the selected group', () => {
  const activeConversation = createConversation('project-two-active', 'project-two', 100, false, true)
  const groups: ConversationGroupPreview[] = [
    {
      folder: {
        conversationCount: 1,
        id: 'project-one',
        isSelected: true,
        name: 'Movie tracker',
        path: 'C:/projects/movie-tracker',
      },
      conversations: [createConversation('project-one-chat', 'project-one', 500)],
    },
    {
      folder: {
        conversationCount: 1,
        id: 'project-two',
        isSelected: false,
        name: 'Data science',
        path: 'C:/projects/data-science',
      },
      conversations: [activeConversation],
    },
  ]

  const result = resolveLatestThreadProjectFor(groups, ALL_PROJECTS_FILTER_ID)

  assert.equal(result?.id, 'project-two')
})

test('resolveLatestThreadProject honors an explicit project filter', () => {
  const result = resolveLatestThreadProjectFor(groups, 'project-two')

  assert.equal(result?.id, 'project-two')
})

test('resolveLatestThreadProject resolves the Chats filter to the Chats option', () => {
  const result = resolveLatestThreadProjectFor(groups, CHATS_PROJECT_FILTER_ID)

  assert.equal(result?.id, CHATS_PROJECT_FILTER_ID)
})

test('resolveLatestThreadProject falls back to the Chats option for the archived filter', () => {
  const result = resolveLatestThreadProjectFor(groups, ARCHIVED_PROJECT_FILTER_ID)

  assert.equal(result?.id, CHATS_PROJECT_FILTER_ID)
})

