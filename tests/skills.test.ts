import assert from 'node:assert/strict'
import test from 'node:test'
import type { SkillSummary } from '../src/types/skills'
import { paginateSkills, searchSkills } from '../electron/skills/service'
import { createSkillTool } from '../electron/chat/shared/tools/skillTool'

const mockSkills: SkillSummary[] = [
  {
    baseDirectory: '/path/to/writing',
    description: 'Guidelines and templates for narrative writing.',
    id: '/path/to/writing/SKILL.md',
    location: '/path/to/writing/SKILL.md',
    name: 'writing',
    source: 'workspace',
    sourceLabel: 'Workspace',
  },
  {
    baseDirectory: '/path/to/coding',
    description: 'Code quality and refactoring standards.',
    id: '/path/to/coding/SKILL.md',
    location: '/path/to/coding/SKILL.md',
    name: 'coding-standards',
    source: 'global',
    sourceLabel: 'Global',
  },
]

test('paginateSkills correctly paginates skills array', () => {
  const result = paginateSkills(mockSkills, 1, 1)
  assert.equal(result.currentPage, 1)
  assert.equal(result.totalPages, 2)
  assert.equal(result.totalSkills, 2)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].name, 'writing')
})

test('searchSkills filters skills by query token matching', () => {
  const writingMatch = searchSkills(mockSkills, 'narrative')
  assert.equal(writingMatch.length, 1)
  assert.equal(writingMatch[0].name, 'writing')

  const codeMatch = searchSkills(mockSkills, 'coding')
  assert.equal(codeMatch.length, 1)
  assert.equal(codeMatch[0].name, 'coding-standards')

  const noMatch = searchSkills(mockSkills, 'nonexistent')
  assert.equal(noMatch.length, 0)
})

test('createSkillTool executes list and search actions', async () => {
  const toolInstance = createSkillTool({ workspaceRootPath: '/workspace' } as any, mockSkills)

  // List action
  const listResult = await (toolInstance.execute as any)({ action: 'list', page: 1 })
  assert.equal(listResult.status, 'success')
  assert.match(listResult.body, /writing/)

  // Search action
  const searchResult = await (toolInstance.execute as any)({ action: 'search', query: 'narrative' })
  assert.equal(searchResult.status, 'success')
  assert.match(searchResult.body, /writing/)
})

test('expandChatMentions expands file, folder, and skill mentions with read:, list:, and load_skill:', async () => {
  const { expandChatMentions, collapseChatMentionMarkup } = await import('../src/lib/chatMentions')
  const map = new Map<string, string>([
    ['writing', 'load_skill:writing'],
    ['main.ts', 'read:src/main.ts'],
    ['components', 'list:src/components'],
  ])

  const expanded = expandChatMentions('Please use @writing to help write @main.ts in @components', map)
  assert.equal(
    expanded,
    'Please use load_skill:writing to help write read:src/main.ts in list:src/components',
  )

  const collapsed = collapseChatMentionMarkup(expanded)
  assert.equal(collapsed, 'Please use @writing to help write @main.ts in @components')
})
