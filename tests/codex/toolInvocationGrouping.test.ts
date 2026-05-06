import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolInvocationTrace } from '../../src/types/chat'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'
import { buildToolInvocationGroupSummary } from '../../src/components/chat/toolInvocationGrouping'

function createInvocation(toolName: string): ToolInvocationTrace {
  return {
    argumentsText: '{}',
    id: `tool-${toolName}`,
    startedAt: 0,
    state: 'completed',
    toolName,
  }
}

function createMutationInvocation(
  id: string,
  kind: 'add' | 'delete' | 'update',
  toolName: 'write' | 'apply_patch',
): ToolInvocationTrace {
  return {
    argumentsText: JSON.stringify({ absolute_path: '/workspace/example.ts' }),
    id,
    resultPresentation: {
      changes: [
        {
          fileName: 'example.ts',
          kind,
          newContent: kind === 'delete' ? '' : 'const value = 1;\n',
          oldContent: kind === 'add' ? null : 'const value = 0;\n',
        },
      ],
      kind: 'change_diff',
    },
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'echosphere.tool_result/v1',
        semantics: {
          added_path_count: kind === 'add' ? 1 : 0,
          deleted_path_count: kind === 'delete' ? 1 : 0,
          operation: 'edit',
          updated_path_count: kind === 'update' ? 1 : 0,
        },
        status: 'success',
        subject: {
          kind: 'file',
          path: '/workspace/example.ts',
        },
        summary: 'Updated example.ts',
        toolCallId: id,
        toolName,
      },
      'updated example.ts',
    ),
    startedAt: 0,
    state: 'completed',
    toolName,
  }
}

test('buildToolInvocationGroupSummary reports list, search, command, and file counts', () => {
  const summary = buildToolInvocationGroupSummary([
    createInvocation('list'),
    createInvocation('glob'),
    createInvocation('run_terminal'),
    createInvocation('read'),
  ])

  assert.equal(summary, 'Explored 1 list, 1 search, ran 1 command, 1 file')
})

test('buildToolInvocationGroupSummary pluralizes grouped categories', () => {
  const summary = buildToolInvocationGroupSummary([
    createInvocation('grep'),
    createInvocation('search_query'),
    createInvocation('exec_command'),
    createInvocation('read'),
    createInvocation('read'),
  ])

  assert.equal(summary, 'Explored 2 searches, ran 1 command, 2 files')
})

test('buildToolInvocationGroupSummary counts write tools inside explored groups', () => {
  const summary = buildToolInvocationGroupSummary([
    createInvocation('write'),
    createInvocation('write'),
  ], 'Explored')

  assert.equal(summary, 'Explored 2 files')
})

test('buildToolInvocationGroupSummary aggregates run_terminal and get_terminal_output as commands', () => {
  const summary = buildToolInvocationGroupSummary([
    createInvocation('run_terminal'),
    createInvocation('get_terminal_output'),
  ])

  assert.equal(summary, 'Explored ran 2 commands')
})

test('buildToolInvocationGroupSummary switches to exploring while a child invocation is active', () => {
  const summary = buildToolInvocationGroupSummary([
    {
      ...createInvocation('run_terminal'),
      state: 'running',
    },
    createInvocation('get_terminal_output'),
  ])

  assert.equal(summary, 'Exploring')
})

test('buildToolInvocationGroupSummary returns only the exploring label for active groups even with mixed tools', () => {
  const summary = buildToolInvocationGroupSummary([
    {
      ...createInvocation('read'),
      state: 'running',
    },
    createInvocation('glob'),
    createInvocation('run_terminal'),
  ], 'Exploring')

  assert.equal(summary, 'Exploring')
})

test('buildToolInvocationGroupSummary allows the explored label to be overridden', () => {
  const summary = buildToolInvocationGroupSummary([createInvocation('run_terminal')], 'Explored')

  assert.equal(summary, 'Explored ran 1 command')
})

test('buildToolInvocationGroupSummary includes uncategorized tools by name', () => {
  const summary = buildToolInvocationGroupSummary([createInvocation('ready_implement')])
  assert.equal(summary, 'Explored 1 ready implement')
})

test('buildToolInvocationGroupSummary reports web search and web fetch with readable labels', () => {
  assert.equal(buildToolInvocationGroupSummary([createInvocation('web_search')]), 'Ran 1 web search')
  assert.equal(
    buildToolInvocationGroupSummary([createInvocation('web_search'), createInvocation('web_search')]),
    'Ran 2 web searches',
  )
  assert.equal(buildToolInvocationGroupSummary([createInvocation('webfetch')]), 'Fetched 1 page')
})

test('buildToolInvocationGroupSummary splits mixed file mutations and exploration categories', () => {
  const summary = buildToolInvocationGroupSummary([
    createMutationInvocation('tool-write-edit-1', 'update', 'write'),
    createMutationInvocation('tool-write-edit-2', 'update', 'apply_patch'),
    createMutationInvocation('tool-write-create-1', 'add', 'write'),
    createMutationInvocation('tool-write-create-2', 'add', 'apply_patch'),
    createInvocation('read'),
    createInvocation('glob'),
    createInvocation('run_terminal'),
    createInvocation('get_terminal_output'),
    createInvocation('run_terminal'),
  ])

  assert.equal(
    summary,
    'Edited 2 files, Created 2 files, Explored 1 file, 1 search, ran 3 commands',
  )
})
