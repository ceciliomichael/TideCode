import assert from 'node:assert/strict'
import test from 'node:test'
import type { SkillSummary } from '../src/types/skills'
import {
  formatStructuredToolResultContent,
  getToolResultDisplayBody,
  getToolResultModelContent,
} from '../src/lib/toolResultContent'
import {
  buildLoadedSkillResult,
  buildSkillToolDescription,
  paginateSkills,
  searchSkills,
} from '../electron/skills/service'
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

test('loaded skill results expose the skill file and base directory to the agent', () => {
  const result = buildLoadedSkillResult({
    ...mockSkills[0],
    content: 'Run scripts/check.mjs before completing the task.',
  })

  assert.equal(result.status, 'success')
  assert.match(result.body ?? '', /Skill file: \/path\/to\/writing\/SKILL\.md/u)
  assert.match(result.body ?? '', /Skill directory: \/path\/to\/writing/u)
  assert.match(result.body ?? '', /Run scripts\/check\.mjs/u)
  assert.deepEqual(result.semantics, {
    skill_directory: '/path/to/writing',
    skill_file: '/path/to/writing/SKILL.md',
    skill_name: 'writing',
  })
})

test('skill location context remains model-visible but is filtered from the displayed result', () => {
  const loadedResult = buildLoadedSkillResult({
    ...mockSkills[0],
    content: 'Run scripts/check.mjs before completing the task.',
  })
  const structuredContent = formatStructuredToolResultContent(
    {
      arguments: {
        action: 'load',
        name: 'writing',
      },
      schema: 'tidecode.tool_result/v1',
      semantics: loadedResult.semantics,
      status: 'success',
      subject: loadedResult.subject,
      summary: loadedResult.summary,
      toolCallId: 'skill-call-1',
      toolName: 'skill',
    },
    loadedResult.body,
  )
  const modelContent = getToolResultModelContent(structuredContent)
  const displayContent = getToolResultDisplayBody('skill', modelContent)

  assert.match(modelContent, /Skill file: \/path\/to\/writing\/SKILL\.md/u)
  assert.match(modelContent, /Skill directory: \/path\/to\/writing/u)
  assert.match(modelContent, /Resolve relative resource and script paths/u)
  assert.doesNotMatch(displayContent, /Skill file:/u)
  assert.doesNotMatch(displayContent, /Skill directory:/u)
  assert.doesNotMatch(displayContent, /Resolve relative resource and script paths/u)
  assert.equal(displayContent, 'Run scripts/check.mjs before completing the task.')
  assert.equal(getToolResultDisplayBody('read', modelContent), modelContent)
})

test('skill tool no longer exposes the read_resource action', () => {
  const description = buildSkillToolDescription()

  assert.doesNotMatch(description, /read_resource/u)
  assert.match(description, /List, search, or load an enabled skill\./u)
})

test('expandChatMentions expands file, folder, skill, and Kanban mentions with read_file:, list:, load_skill:, and kanban:', async () => {
  const { expandChatMentions, collapseChatMentionMarkup, findChatMentionMatches, buildChatMentionPathMap } = await import('../src/lib/chatMentions')
  const map = new Map<string, string>([
    ['writing', 'load_skill:writing'],
    ['main.ts', 'read_file:src/main.ts'],
    ['components', 'list:src/components'],
    ['Fix login bug', 'kanban:card-123'],
    ['AllSpaces AI Engine — Complete Step-by-Step Build Guide.md', 'read_file:AllSpaces AI Engine — Complete Step-by-Step Build Guide.md'],
  ])

  const expanded = expandChatMentions(
    'Please use @writing to help write @main.ts in @components for @Fix login bug and @AllSpaces AI Engine — Complete Step-by-Step Build Guide.md',
    map,
  )
  // All action tags now wrapped in [[...]] delimiters — unambiguous boundaries
  assert.equal(
    expanded,
    'Please use [[load_skill:writing]] to help write [[read_file:src/main.ts]] in [[list:src/components]] for [[kanban:card-123]] and [[read_file:AllSpaces AI Engine — Complete Step-by-Step Build Guide.md]]',
  )

  const collapsed = collapseChatMentionMarkup(expanded)
  assert.equal(
    collapsed,
    'Please use @writing to help write @main.ts in @components for @card-123 and @AllSpaces AI Engine — Complete Step-by-Step Build Guide.md',
  )

  const pathMap = buildChatMentionPathMap(expanded)
  assert.equal(pathMap.get('card-123'), 'kanban:card-123')
  assert.equal(pathMap.get('AllSpaces AI Engine — Complete Step-by-Step Build Guide.md'),
    'read_file:AllSpaces AI Engine — Complete Step-by-Step Build Guide.md',
  )

  const matches = findChatMentionMatches(expanded)
  assert.equal(matches.length, 5)
  assert.equal(matches[3].label, 'card-123')
  assert.equal(matches[3].path, 'kanban:card-123')
  assert.equal(matches[4].label, 'AllSpaces AI Engine — Complete Step-by-Step Build Guide.md')

  // Adjacent mentions with no space-bleed between them
  const adjacent = expandChatMentions('@writing @main.ts', map)
  assert.equal(adjacent, '[[load_skill:writing]] [[read_file:src/main.ts]]')
  const adjacentCollapsed = collapseChatMentionMarkup(adjacent)
  assert.equal(adjacentCollapsed, '@writing @main.ts')

  const attached = expandChatMentions('release@main.ts', map)
  assert.equal(attached, 'release[[read_file:src/main.ts]]')
  assert.deepEqual(
    findChatMentionMatches('release@main.ts', map),
    [{ end: 'release@main.ts'.length, label: 'main.ts', path: 'read_file:src/main.ts', start: 'release'.length }],
  )

  // Typing normal text after a [[]] mention must NOT bleed into the adjacent text
  const withNormalText = '[[load_skill:natural-writing]] create a new mark'
  const withNormalMatches = findChatMentionMatches(withNormalText)
  assert.equal(withNormalMatches.length, 1)
  assert.equal(withNormalMatches[0].label, 'natural-writing')
  assert.equal(withNormalMatches[0].end, '[[load_skill:natural-writing]]'.length)

  const removedLegacyRead = 'u study [[read:AllSpaces AI Engine — Complete Step-by-Step Build Guide.md]]'
  assert.equal(findChatMentionMatches(removedLegacyRead).length, 0)
  assert.equal(collapseChatMentionMarkup(removedLegacyRead), removedLegacyRead)

  const removedBareRead = 'u study read:AllSpaces AI Engine — Complete Step-by-Step Build Guide.md'
  assert.equal(findChatMentionMatches(removedBareRead).length, 0)
  assert.equal(collapseChatMentionMarkup(removedBareRead), removedBareRead)

  // Verify getChatMentionTriggerState returns null when typing normal text after a completed mention
  const { getChatMentionTriggerState } = await import('../src/lib/chatMentions')
  const completedText = '@natural-writing create a new mark'
  const triggerMap = new Map([['natural-writing', 'load_skill:natural-writing']])
  const triggerState = getChatMentionTriggerState(completedText, completedText.length, triggerMap)
  assert.equal(triggerState, null)
})

test('createSkill creates a valid skill directory and file', async () => {
  const os = await import('node:os')
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { createSkill } = await import('../electron/skills/service')

  const globalSkillFile = path.join(os.homedir(), '.tidecode', 'skills', 'test-skill', 'SKILL.md')
  try {
    const result = await createSkill({
      name: 'test-skill',
      description: 'Test skill description',
      content: '# Test Skill Instructions',
    })

    assert.equal(result.error, undefined)
    assert.ok(result.skill)
    assert.equal(result.skill.name, 'test-skill')
    assert.equal(result.skill.description, 'Test skill description')

    const fileContent = await fs.readFile(globalSkillFile, 'utf8')
    assert.match(fileContent, /---/)
    assert.match(fileContent, /name: test-skill/)
    assert.match(fileContent, /# Test Skill Instructions/)
  } finally {
    await fs.rm(path.dirname(globalSkillFile), { recursive: true, force: true })
  }
})
