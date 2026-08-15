import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationFolderRecord, ConversationRecord } from '../../src/types/chat'
import {
  buildResumeConversationItems,
  buildResumeConversationSections,
  filterResumeConversationItems,
  getResumeProjectLabel,
} from '../../electron/cli/resumeCatalog'
import { stripAnsi } from '../../electron/cli/terminalText'

function conversation(id: string, updatedAt: number, isArchived = false): ConversationRecord {
  return {
    agentContextRootPath: 'C:/workspace',
    chatMode: 'agent',
    createdAt: 1,
    folderId: 'project-1',
    id,
    isArchived,
    messages: [],
    title: id,
    updatedAt,
  }
}

test('resume catalog scopes conversations to the active project path', () => {
  const folders: ConversationFolderRecord[] = [
    {
      createdAt: 1,
      id: 'project-1',
      name: 'Project One',
      path: 'C:/projects/project1',
      updatedAt: 1,
    },
    {
      createdAt: 1,
      id: 'project-2',
      name: 'Project Two',
      path: 'C:/projects/project2',
      updatedAt: 1,
    },
  ]
  const items = buildResumeConversationItems([
    { ...conversation('project-one', 20), agentContextRootPath: 'c:\\projects\\PROJECT1\\' },
    { ...conversation('project-two', 30), agentContextRootPath: 'C:/projects/project2' },
  ], folders)

  assert.equal(getResumeProjectLabel('C:/projects/project1', folders), 'Project One')
  assert.deepEqual(filterResumeConversationItems(items, 'C:/projects/project1').map((item) => item.id), ['project-one'])
})

test('resume catalog keeps active and archived conversations separate and newest first', () => {
  const folders: ConversationFolderRecord[] = [{
    createdAt: 1,
    id: 'project-1',
    name: 'TideCode',
    path: 'C:/workspace',
    updatedAt: 1,
  }]
  const sections = buildResumeConversationSections([
    conversation('older-active', 10),
    conversation('archived', 30, true),
    conversation('newer-active', 20),
  ], folders)

  assert.deepEqual(sections.map((section) => section.label), ['Active', 'Archived'])
  assert.deepEqual(sections[0].items.map((item) => item.value), ['newer-active', 'older-active'])
  assert.deepEqual(sections[1].items.map((item) => item.value), ['archived'])
  assert.match(stripAnsi(sections[0].items[0].badge ?? ''), /project: TideCode/)
})
