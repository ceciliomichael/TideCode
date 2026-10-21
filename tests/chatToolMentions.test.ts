import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChatMentionPathMap,
  collapseChatMentionMarkup,
  expandChatMentions,
  findChatMentionMatches,
  getChatMentionTarget,
  getChatMentionTooltipTarget,
  getChatMentionTriggerState,
  resolveChatMentionNativeDeletionChange,
} from '../src/lib/chatMentions'
import { restoreChatComposerDraft } from '../src/lib/chatComposerDraft'
import { getAttachmentMentionEntries, getChatMentionCategories, getMcpMentionEntries } from '../src/components/chat/chatMentionCatalog'
import type { McpServerConfig, McpState } from '../src/types/mcp'

test('all catalog references send explicit tools while preserving their exact targets', () => {
  const references = new Map([
    ['main.ts', '@workspace/tidecode/src/main.ts'],
    ['components', '@workspace/tidecode/src/components/'],
    ['report.pdf', '@attachments/report.pdf'],
    ['references', '@attachments/references/'],
    ['writing', 'tools.skill.load:writing'],
    ['GitHub Enterprise', 'tools.available.search:GitHub Enterprise'],
  ])
  const text = 'Use @main.ts @components @report.pdf @references @writing @GitHub Enterprise please'
  const expanded = expandChatMentions(text, references)
  assert.equal(expanded, 'Use [[tools.read:@workspace/tidecode/src/main.ts]] [[tools.list:@workspace/tidecode/src/components/]] [[tools.read:@attachments/report.pdf]] [[tools.list:@attachments/references/]] [[tools.skill.load:writing]] [[tools.available.search:GitHub Enterprise]] please')
  assert.equal(collapseChatMentionMarkup(expanded, references), text)
  const draft = restoreChatComposerDraft(expanded, Object.fromEntries(references))
  assert.equal(draft.value, text)
  assert.equal(expandChatMentions(draft.value, draft.mentionPathMap), expanded)
  assert.equal(getChatMentionTarget(findChatMentionMatches(expanded)[2].path!), '@attachments/report.pdf')
})

test('mention targets show only the selected path or name without tool prefixes', () => {
  const references: ReadonlyArray<readonly [string, string]> = [
    ['tools.read:@workspace/tidecode/src/main.ts', '@workspace/tidecode/src/main.ts'],
    ['tools.list:@workspace/tidecode/src/components/', '@workspace/tidecode/src/components/'],
    ['tools.read:@attachments/report.pdf', '@attachments/report.pdf'],
    ['tools.list:@attachments/references/', '@attachments/references/'],
    ['tools.skill.load:writing', 'writing'],
    ['tools.available.search:GitHub Enterprise', 'GitHub Enterprise'],
    ['read_file:@workspace/tidecode/src/main.ts', '@workspace/tidecode/src/main.ts'],
    ['list:@workspace/tidecode/src/components/', '@workspace/tidecode/src/components/'],
    ['load_skill:writing', 'writing'],
  ]

  for (const [reference, target] of references) {
    assert.equal(getChatMentionTarget(reference), target)
  }
})

test('mention tooltips show virtual skill and MCP prefixes without changing attachment targets', () => {
  const references: ReadonlyArray<readonly [string, string]> = [
    ['tools.skill.load:writing', '@skills/writing'],
    ['load_skill:writing', '@skills/writing'],
    ['tools.available.search:GitHub Enterprise', '@mcp/GitHub Enterprise'],
    ['@skills/writing/SKILL.md', '@skills/writing/SKILL.md'],
    ['tools.read:@workspace/tidecode/src/main.ts', '@workspace/tidecode/src/main.ts'],
    ['tools.read:@attachments/preview.png', '@attachments/preview.png'],
  ]

  for (const [reference, target] of references) {
    assert.equal(getChatMentionTooltipTarget(reference), target)
  }

  assert.equal(getChatMentionTarget('tools.skill.load:writing'), 'writing')
  assert.equal(getChatMentionTarget('tools.available.search:GitHub Enterprise'), 'GitHub Enterprise')
})

test('MCP markers restore their names without swallowing adjacent normal text', () => {
  const marker = '[[tools.available.search:GitHub Enterprise]]'
  const text = `${marker}, then inspect this repository.`
  assert.deepEqual(findChatMentionMatches(text), [{
    start: 0,
    end: marker.length,
    label: 'GitHub Enterprise',
    path: 'tools.available.search:GitHub Enterprise',
  }])
  const references = buildChatMentionPathMap(text)
  assert.equal(expandChatMentions(collapseChatMentionMarkup(text), references), text)
  assert.equal(getChatMentionTriggerState(marker, marker.length), null)
  assert.deepEqual(resolveChatMentionNativeDeletionChange({
    previousText: text,
    nextText: text.replace('Enterprise', 'Enterpris'),
  }), { nextCursorPosition: 0, nextValue: ', then inspect this repository.' })
})

test('duplicate file labels retain their saved display names when wrapped', () => {
  const references = new Map([['main.ts (2)', '@workspace/tidecode/other/main.ts']])
  const text = 'See @main.ts (2) please'
  assert.equal(collapseChatMentionMarkup(expandChatMentions(text, references), references), text)
})

test('MCP catalog includes only enabled connected servers without status labels', () => {
  const server = (id: string, enabled = true): McpServerConfig => ({
    id,
    name: id,
    enabled,
    autoConnect: false,
    owner: 'tidecode',
    isReadOnly: false,
    source: 'global',
    toolNamespace: id,
    type: 'stdio',
  })
  const state: McpState = {
    configs: [server('connected'), server('disconnected'), server('connecting'), server('error'), server('disabled', false), server('unknown')],
    errorMessage: null,
    statuses: {
      connected: { serverId: 'connected', status: 'connected' },
      disconnected: { serverId: 'disconnected', status: 'disconnected' },
      connecting: { serverId: 'connecting', status: 'connecting' },
      error: { serverId: 'error', status: 'error' },
      disabled: { serverId: 'disabled', status: 'connected' },
    },
  }
  assert.deepEqual(getMcpMentionEntries(state), [{
    label: 'connected',
    kind: 'mcp',
    description: 'MCP server',
    relativePath: 'tools.available.search:connected',
  }])
  state.statuses.connected.status = 'disconnected'
  assert.deepEqual(getMcpMentionEntries(state), [])
})

test('attachment and MCP categories appear only when available, preserving category order', () => {
  assert.deepEqual(getChatMentionCategories(false, false).map((category) => category.kind), ['file', 'folder', 'skill'])
  assert.deepEqual(getChatMentionCategories(true, false).map((category) => category.kind), ['file', 'folder', 'attachment', 'skill'])
  assert.deepEqual(getChatMentionCategories(false, true).map((category) => category.kind), ['file', 'folder', 'skill', 'mcp'])
  assert.deepEqual(getChatMentionCategories(true, true).map((category) => category.kind), ['file', 'folder', 'attachment', 'skill', 'mcp'])
})

test('new draft attachments immediately populate the catalog before stored attachments load', () => {
  const entries = getAttachmentMentionEntries([
    { fileName: 'spec.pdf', kind: 'file', path: '@attachments/spec.pdf' },
    { fileName: 'references', kind: 'folder', path: '@attachments/references/' },
    { fileName: 'inline.png', kind: 'image' },
  ])
  assert.deepEqual(entries.map((entry) => [entry.label, entry.relativePath, entry.isDirectory]), [
    ['spec.pdf', '@attachments/spec.pdf', false],
    ['references', '@attachments/references/', true],
  ])
  assert.equal(getChatMentionCategories(entries.length > 0, false).some((category) => category.kind === 'attachment'), true)
})

test('stored and draft attachment results merge by path without hiding a newly added attachment', () => {
  const stored = { fileName: 'spec.pdf', kind: 'file' as const, path: '@attachments/spec.pdf' }
  const entries = getAttachmentMentionEntries([
    stored,
    { ...stored },
    { fileName: 'new.png', kind: 'image', path: '@attachments/new.png' },
  ])
  assert.deepEqual(entries.map((entry) => entry.label), ['spec.pdf', 'new.png'])
})
