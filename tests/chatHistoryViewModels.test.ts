import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationFolderSummary, ConversationSummary } from '../src/types/chat'
import {
  getFolderIdForWorkspacePath,
  insertFolderSummary,
  moveFolderSummary,
  orderConversationFamilies,
  reorderFolderSummary,
} from '../src/hooks/chatHistoryViewModels'

const folderSummaries: ConversationFolderSummary[] = [
  {
    id: 'folder-a',
    name: 'Project Alpha',
    path: 'C:\\Projects\\Alpha',
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'folder-b',
    name: 'Project Beta',
    path: 'D:/work/Beta',
    createdAt: 2,
    updatedAt: 2,
  },
]

test('getFolderIdForWorkspacePath resolves the matching folder id for a workspace path', () => {
  assert.equal(getFolderIdForWorkspacePath(folderSummaries, 'C:/Projects/Alpha'), 'folder-a')
})

test('getFolderIdForWorkspacePath treats path separators and case differences as equivalent', () => {
  assert.equal(getFolderIdForWorkspacePath(folderSummaries, 'd:\\WORK\\beta'), 'folder-b')
})

test('getFolderIdForWorkspacePath returns null for unmatched or empty paths', () => {
  assert.equal(getFolderIdForWorkspacePath(folderSummaries, 'C:/Projects/Gamma'), null)
  assert.equal(getFolderIdForWorkspacePath(folderSummaries, '   '), null)
})

test('insertFolderSummary preserves explicit folder ordering', () => {
  const nextFolders = insertFolderSummary(folderSummaries, {
    id: 'folder-c',
    name: 'Project Gamma',
    path: '/projects/gamma',
    createdAt: 3,
    updatedAt: 3,
  })

  assert.deepEqual(nextFolders.map((folder) => folder.id), ['folder-a', 'folder-b', 'folder-c'])
})

test('moveFolderSummary reorders folders by moving a folder up or down', () => {
  const movedDown = moveFolderSummary(folderSummaries, 'folder-a', 'down')
  assert.deepEqual(movedDown.map((folder) => folder.id), ['folder-b', 'folder-a'])

  const movedUp = moveFolderSummary(folderSummaries, 'folder-b', 'up')
  assert.deepEqual(movedUp.map((folder) => folder.id), ['folder-b', 'folder-a'])
})

test('reorderFolderSummary places a folder before or after the target folder', () => {
  const movedBefore = reorderFolderSummary(folderSummaries, {
    folderId: 'folder-b',
    position: 'before',
    targetFolderId: 'folder-a',
  })
  assert.deepEqual(movedBefore.map((folder) => folder.id), ['folder-b', 'folder-a'])

  const movedAfter = reorderFolderSummary(folderSummaries, {
    folderId: 'folder-a',
    position: 'after',
    targetFolderId: 'folder-b',
  })
  assert.deepEqual(movedAfter.map((folder) => folder.id), ['folder-b', 'folder-a'])
})

test('reorderFolderSummary ignores invalid moves', () => {
  const sameFolderMove = reorderFolderSummary(folderSummaries, {
    folderId: 'folder-a',
    position: 'before',
    targetFolderId: 'folder-a',
  })
  assert.deepEqual(sameFolderMove.map((folder) => folder.id), ['folder-a', 'folder-b'])

  const invalidSourceMove = reorderFolderSummary(folderSummaries, {
    folderId: 'missing',
    position: 'before',
    targetFolderId: 'folder-a',
  })
  assert.deepEqual(invalidSourceMove.map((folder) => folder.id), ['folder-a', 'folder-b'])

  const invalidTargetMove = reorderFolderSummary(folderSummaries, {
    folderId: 'folder-a',
    position: 'after',
    targetFolderId: 'missing',
  })
  assert.deepEqual(invalidTargetMove.map((folder) => folder.id), ['folder-a', 'folder-b'])
})

test('orderConversationFamilies keeps compactions beside their original in chronological order', () => {
  const buildSummary = (
    id: string,
    updatedAt: number,
    compaction?: ConversationSummary['compaction'],
  ): ConversationSummary => ({
    agentContextRootPath: '/workspace',
    chatMode: 'agent',
    ...(compaction ? { compaction } : {}),
    folderId: null,
    id,
    messageCount: 1,
    preview: id,
    title: id,
    updatedAt,
  })
  const original = buildSummary('original', 10)
  const compactOne = buildSummary('compact-1', 30, {
    compactedAt: 20,
    depth: 1,
    rootConversationId: 'original',
    sequence: 1,
    sourceConversationId: 'original',
  })
  const compactTwo = buildSummary('compact-2', 40, {
    compactedAt: 40,
    depth: 2,
    rootConversationId: 'original',
    sequence: 2,
    sourceConversationId: 'compact-1',
  })
  const other = buildSummary('other', 35)

  assert.deepEqual(
    orderConversationFamilies([compactTwo, other, original, compactOne]).map((summary) => summary.id),
    ['original', 'compact-1', 'compact-2', 'other'],
  )
})
