import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolInvocationTrace } from '../../src/types/chat'
import {
  createTerminatedToolResultContent,
  formatStructuredToolResultContent,
  getToolResultDisplayBody,
} from '../../src/lib/toolResultContent'
import {
  getToolInvocationDisplayEntries,
  getToolInvocationHeaderLabel,
} from '../../src/components/chat/toolInvocationPresentation'
import { buildToolInvocationGroupSummary } from '../../src/components/chat/toolInvocationGrouping'
import { getTerminalToolPresentationItems } from '../../electron/cli/desktopToolPresentation'

const WORKSPACE_ROOT_PATH = '/workspace'
const TARGET_FILE_PATH = `${WORKSPACE_ROOT_PATH}/src/example.ts`

test('discovery, skill, and MCP calls show specific labels and readable results', () => {
  const invocation = (toolName: string, args: object): ToolInvocationTrace => ({
    argumentsText: JSON.stringify(args), id: toolName, startedAt: 0, state: 'completed', toolName,
  })

test('multiple retrieved contracts display as individually named nested tool blocks', () => {
  const calls = ['tools.read', 'tools.skill.list'].map((name) => ({
    name: 'available.get', arguments: { name }, status: 'success', summary: 'Retrieved tools', body: JSON.stringify({ name }),
  }))
  const outer: ToolInvocationTrace = {
    argumentsText: '{}', id: 'exec-multiple-get', startedAt: 0, state: 'completed', toolName: 'exec',
    resultContent: formatStructuredToolResultContent({
      schema: 'tidecode.tool_result/v1', status: 'success', summary: 'Completed',
      toolCallId: 'exec-multiple-get', toolName: 'exec', semantics: { tool_calls: calls },
    }, 'Retrieved contracts'),
  }
  const entries = getToolInvocationDisplayEntries(outer)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((entry) => getToolInvocationHeaderLabel(entry.invocation)), [
    'Retrieved read contract', 'Retrieved skill.list contract',
  ])
})
  assert.equal(getToolInvocationHeaderLabel(invocation('available.search', { query: 'repository' })), 'Searched tools')
  assert.equal(getToolInvocationHeaderLabel(invocation('available.get', { name: 'tools.read' })), 'Retrieved read contract')
  assert.equal(getToolInvocationHeaderLabel(invocation('available.get', { name: 'tools.mcp.search_tool' })), 'Retrieved mcp.search_tool contract')
  assert.equal(getToolInvocationHeaderLabel(invocation('skill.list', {})), 'Listed skills')
  assert.equal(getToolInvocationHeaderLabel(invocation('skill.search', { query: 'typescript' })), 'Searched skills for typescript')
  assert.equal(getToolInvocationHeaderLabel(invocation('skill.load', { name: 'review' })), 'Loaded skill review')
  assert.equal(getToolInvocationHeaderLabel(invocation('mcp.search_repositories', { query: 'tidecode' })), 'Ran MCP search repositories')
  assert.match(buildToolInvocationGroupSummary([
    invocation('available.search', { query: 'repo' }),
    invocation('available.get', { name: 'tools.read' }),
    invocation('skill.load', { name: 'review' }),
    invocation('mcp.search_repositories', {}),
  ]), /tool/u)
})

test('plan tool headers use review-oriented labels', () => {
  assert.equal(
    getToolInvocationHeaderLabel({
      argumentsText: '{}',
      id: 'plan-create',
      startedAt: 0,
      state: 'completed',
      toolName: 'plan.create',
    }),
    'Created plan',
  )
  assert.equal(
    getToolInvocationHeaderLabel({
      argumentsText: JSON.stringify({ content: '# Updated plan', path: '.tidecode/plans/plan-001.md' }),
      id: 'plan-edit',
      resultContent: formatStructuredToolResultContent({
        schema: 'tidecode.tool_result/v1',
        status: 'success',
        subject: { kind: 'plan', path: '.tidecode/plans/plan-001.md' },
        summary: 'Updated implementation plan plan-001.md',
        toolCallId: 'plan-edit',
        toolName: 'patch',
      }, 'Updated plan.'),
      resultPresentation: {
        content: '# Updated plan\n',
        fileName: 'plan-001.md',
        kind: 'plan',
        operation: 'updated',
        planId: '001',
        relativePath: '.tidecode/plans/plan-001.md',
        title: 'Updated plan',
        updatedAt: 1,
      },
      startedAt: 0,
      state: 'completed',
      toolName: 'patch',
    }),
    'Edited plan-001.md',
  )
})

function buildFileChangeInvocation(
  kind: 'add' | 'delete' | 'update',
  state: ToolInvocationTrace['state'],
  overrides?: Partial<ToolInvocationTrace>,
) {
  const semanticsByKind = {
    add: {
      added_path_count: 1,
      deleted_path_count: 0,
      operation: 'patch',
      updated_path_count: 0,
    },
    delete: {
      added_path_count: 0,
      deleted_path_count: 1,
      operation: 'patch',
      updated_path_count: 0,
    },
    update: {
      added_path_count: 0,
      deleted_path_count: 0,
      operation: 'patch',
      updated_path_count: 1,
    },
  } as const

  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ path: TARGET_FILE_PATH }),
    id: 'tool-1',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: semanticsByKind[kind],
        status: 'success',
        subject: {
          kind: 'file',
          path: TARGET_FILE_PATH,
        },
        summary: 'Wrote file change',
        toolCallId: 'tool-1',
        toolName: 'write',
      },
      null,
    ),
    startedAt: 0,
    state,
    toolName: 'write',
    ...overrides,
  }

  return invocation
}

function buildMultiFileWriteInvocation(
  toolName: 'write' | 'patch' | 'patch',
  state: ToolInvocationTrace['state'],
  changes: Array<{
    fileName: string
    kind: 'add' | 'delete' | 'update'
    oldContent: string | null
    newContent: string
  }>,
) {
  return {
    argumentsText: JSON.stringify({ path: `${WORKSPACE_ROOT_PATH}/.` }),
    id: 'tool-multi-1',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          added_path_count: changes.filter((change) => change.kind === 'add').length,
          deleted_path_count: changes.filter((change) => change.kind === 'delete').length,
          operation: 'patch',
          updated_path_count: changes.filter((change) => change.kind === 'update').length,
        },
        status: 'success',
        subject: {
          kind: 'workspace',
          path: '.',
        },
        summary: 'Patched multiple files',
        toolCallId: 'tool-multi-1',
        toolName,
      },
      [
        'Patched multiple files',
        ...changes.map((change) => `${change.kind === 'add' ? 'A' : change.kind === 'delete' ? 'D' : 'M'} ${change.fileName}`),
      ].join('\n'),
    ),
    resultPresentation: {
      changes: changes.map((change) => ({
        fileName: change.fileName,
        kind: change.kind,
        newContent: change.newContent,
        oldContent: change.oldContent,
      })),
      kind: 'change_diff' as const,
    },
    startedAt: 0,
    state,
    toolName,
  } satisfies ToolInvocationTrace
}

test('write tool header labels use change-specific verbs', () => {
  assert.equal(getToolInvocationHeaderLabel(buildFileChangeInvocation('add', 'running'), undefined, WORKSPACE_ROOT_PATH), 'Creating example.ts')
  assert.equal(getToolInvocationHeaderLabel(buildFileChangeInvocation('add', 'completed'), undefined, WORKSPACE_ROOT_PATH), 'Created example.ts')
  assert.equal(getToolInvocationHeaderLabel(buildFileChangeInvocation('add', 'failed'), undefined, WORKSPACE_ROOT_PATH), 'Create failed example.ts')

  assert.equal(getToolInvocationHeaderLabel(buildFileChangeInvocation('update', 'running'), undefined, WORKSPACE_ROOT_PATH), 'Editing example.ts')
  assert.equal(getToolInvocationHeaderLabel(buildFileChangeInvocation('update', 'completed'), undefined, WORKSPACE_ROOT_PATH), 'Edited example.ts')
  assert.equal(getToolInvocationHeaderLabel(buildFileChangeInvocation('update', 'failed'), undefined, WORKSPACE_ROOT_PATH), 'Edit failed example.ts')
})

test('write tool header labels keep mixed changes on the edit fallback', () => {
  const invocation = buildFileChangeInvocation('update', 'completed', {
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          added_path_count: 1,
          deleted_path_count: 0,
          operation: 'patch',
          updated_path_count: 1,
        },
        status: 'success',
        subject: {
          kind: 'workspace',
          path: '.',
        },
        summary: 'Wrote mixed file changes',
        toolCallId: 'tool-1',
        toolName: 'write',
      },
      null,
    ),
  })

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), 'Edited example.ts')
})

test('running file mutation invocations stay hidden until completion', () => {
  const runningEditInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      path: `${WORKSPACE_ROOT_PATH}/src/example.ts`,
      replacementContent: 'const value = 2;',
      targetContent: 'const value = 1;',
    }),
    id: 'tool-edit-running-single',
    startedAt: 0,
    state: 'running',
    toolName: 'patch',
  }

  const runningWriteInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      path: `${WORKSPACE_ROOT_PATH}/src/example.ts`,
    }),
    id: 'tool-write-running-single',
    startedAt: 0,
    state: 'running',
    toolName: 'write',
  }

  assert.deepEqual(getToolInvocationDisplayEntries(runningEditInvocation), [])
  assert.deepEqual(getToolInvocationDisplayEntries(runningWriteInvocation), [])
})

test('Code Mode shows completed outer results when no nested tools ran', () => {
  const runningInvocation: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'code-mode-running-1',
    startedAt: 0,
    state: 'running',
    toolName: 'exec',
  }
  assert.deepEqual(getToolInvocationDisplayEntries(runningInvocation), [])
  assert.equal(getToolInvocationHeaderLabel(runningInvocation), 'Running code')

  const completedInvocation: ToolInvocationTrace = {
    ...runningInvocation,
    id: 'code-mode-completed-without-trace',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          operation: 'exec',
          tool_call_count: 0,
          tool_calls: [],
        },
        status: 'success',
        subject: { kind: 'exec', path: 'local' },
        summary: 'Code Mode completed with 0 tool calls.',
        toolCallId: 'code-mode-completed-without-trace',
        toolName: 'exec',
      },
      '{"scrambleCount":10,"solveCount":10}',
    ),
    state: 'completed',
  }
  assert.deepEqual(
    getToolInvocationDisplayEntries(completedInvocation).map((entry) => entry.invocation.toolName),
    ['exec'],
  )
  assert.equal(getToolInvocationHeaderLabel(completedInvocation), 'Ran code')
  assert.equal(buildToolInvocationGroupSummary([completedInvocation]), 'Ran code')
  assert.equal(getToolInvocationDisplayEntries(completedInvocation)[0]?.invocation.resultContent?.includes('scrambleCount'), true)
  assert.equal(
    getToolResultDisplayBody('exec', 'Code Mode completed with 0 tool calls.\n\n{"scrambleCount":10}'),
    '{"scrambleCount":10}',
  )

  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      code: "const file = await tools.read({ path: 'src/example.ts' }); return file",
    }),
    completedAt: 100,
    id: 'code-mode-tools-1',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          operation: 'exec',
          tool_calls: [
            {
              arguments: { path: 'src/example.ts' },
              body: 'File: src/example.ts\n\nexport const value = 1;',
              name: 'read',
              status: 'success',
              subject: { kind: 'file', path: 'src/example.ts' },
              summary: 'Read src/example.ts',
            },
            {
              arguments: { query: 'value', path: 'src' },
              body: 'src/example.ts:1: export const value = 1;',
              name: 'grep',
              status: 'success',
              summary: 'Found 1 match.',
            },
            {
              arguments: { command: 'npm test -- example' },
              body: 'Tests passed.',
              name: 'terminal.execute',
              status: 'success',
              summary: 'Command completed.',
            },
          ],
        },
        status: 'success',
        subject: { kind: 'exec', path: 'local' },
        summary: 'Code Mode completed with 3 tool calls.',
        toolCallId: 'code-mode-tools-1',
        toolName: 'exec',
      },
      '{"done":true}',
    ),
    startedAt: 0,
    state: 'completed',
    toolName: 'exec',
  }

  const entries = getToolInvocationDisplayEntries(invocation)
  assert.deepEqual(entries.map((entry) => entry.invocation.toolName), ['read', 'grep', 'terminal.execute'])
  assert.equal(
    getToolInvocationHeaderLabel(entries[0].invocation, undefined, WORKSPACE_ROOT_PATH),
    'Read example.ts',
  )
  assert.equal(entries[0].invocation.resultContent?.includes('export const value = 1;'), true)
  assert.equal(
    buildToolInvocationGroupSummary(entries.map((entry) => entry.invocation)),
    'Ran 1 search, ran 1 terminal tool, explored 1 file',
  )
})

test('failed Code Mode keeps the outer failure visible alongside nested tool results', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: '{}',
    completedAt: 100,
    id: 'code-mode-failed-with-trace',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          operation: 'exec',
          tool_calls: [
            {
              arguments: { path: '.' },
              body: 'Listed workspace.',
              name: 'list',
              status: 'success',
              summary: 'Listed .',
            },
          ],
        },
        status: 'error',
        subject: { kind: 'exec', path: 'local' },
        summary: 'Code Mode failed: returned an unresolved Promise.',
        toolCallId: 'code-mode-failed-with-trace',
        toolName: 'exec',
      },
      'Code Mode failed: returned an unresolved Promise.',
    ),
    startedAt: 0,
    state: 'failed',
    toolName: 'exec',
  }

  const entries = getToolInvocationDisplayEntries(invocation)
  assert.deepEqual(entries.map((entry) => entry.invocation.toolName), ['exec', 'list'])
  assert.equal(entries[0]?.invocation.state, 'failed')
  assert.equal(getToolInvocationHeaderLabel(entries[0]?.invocation ?? invocation), 'Code failed')
  assert.equal(buildToolInvocationGroupSummary(entries.map((entry) => entry.invocation)), 'Explored 1 list, local orchestration failed')
})

test('cancelled Code Mode hides the outer tool block in desktop and CLI presentation', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ code: 'await tools.list({ path: "." })' }),
    completedAt: 100,
    id: 'code-mode-cancelled',
    resultContent: createTerminatedToolResultContent({
      argumentsValue: { code: 'await tools.list({ path: "." })' },
      toolCallId: 'code-mode-cancelled',
      toolName: 'exec',
    }),
    startedAt: 0,
    state: 'failed',
    toolName: 'exec',
  }

  assert.deepEqual(getToolInvocationDisplayEntries(invocation), [])
  assert.deepEqual(getTerminalToolPresentationItems(invocation, WORKSPACE_ROOT_PATH), [])
})

test('sub-tool only failure in Code Mode renders child entries independently without outer failure block', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: '{}',
    completedAt: 100,
    id: 'code-mode-subtool-failure',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          operation: 'exec',
          tool_calls: [
            {
              arguments: { path: 'src/lib/taskContracts.ts' },
              body: 'export const TASK_COLUMN_IDS = ...',
              name: 'read',
              status: 'success',
              summary: 'Read src/lib/taskContracts.ts',
            },
            {
              arguments: { path: 'electron/ipc/task.ts' },
              body: 'Path not found: electron/ipc/task.ts. Use a path relative to the workspace root.',
              name: 'read',
              status: 'error',
              summary: 'Path not found: electron/ipc/task.ts. Use a path relative to the workspace root.',
            },
          ],
        },
        status: 'error',
        subject: { kind: 'exec', path: 'local' },
        summary: 'Code Mode finished with 1 failed tool call.',
        toolCallId: 'code-mode-subtool-failure',
        toolName: 'exec',
      },
      'Code Mode finished with 1 failed tool call.',
    ),
    startedAt: 0,
    state: 'failed',
    toolName: 'exec',
  }

  const entries = getToolInvocationDisplayEntries(invocation)
  assert.deepEqual(entries.map((entry) => entry.invocation.toolName), ['read', 'read'])
  assert.equal(entries[0]?.invocation.state, 'completed')
  assert.equal(entries[1]?.invocation.state, 'failed')
})

test('multi-file edit invocations stay hidden until they complete', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      path: `${WORKSPACE_ROOT_PATH}/src/first.ts`,
      replacementContent: 'const first = 2;',
      targetContent: 'const first = 1;',
    }),
    id: 'tool-edit-running-multi',
    startedAt: 0,
    state: 'running',
    toolName: 'patch',
  }

  assert.deepEqual(getToolInvocationDisplayEntries(invocation), [])
})

test('multi-file write invocations expand into separate display blocks', () => {
  const invocation = buildMultiFileWriteInvocation('write', 'completed', [
    {
      fileName: 'src/first.ts',
      kind: 'update',
      oldContent: 'const first = 1;\n',
      newContent: 'const first = 2;\n',
    },
    {
      fileName: 'src/second.ts',
      kind: 'add',
      oldContent: null,
      newContent: 'export const second = 2;\n',
    },
  ])

  const displayEntries = getToolInvocationDisplayEntries(invocation)

  assert.equal(displayEntries.length, 2)
  assert.equal(
    getToolInvocationHeaderLabel(displayEntries[0].invocation, undefined, WORKSPACE_ROOT_PATH),
    'Edited first.ts',
  )
  assert.equal(
    getToolInvocationHeaderLabel(displayEntries[1].invocation, undefined, WORKSPACE_ROOT_PATH),
    'Created second.ts',
  )
  assert.equal(displayEntries[0].invocation.resultPresentation?.kind, 'change_diff')
  assert.equal(displayEntries[0].invocation.resultPresentation?.changes.length, 1)
  assert.equal(displayEntries[1].invocation.resultPresentation?.kind, 'change_diff')
  assert.equal(displayEntries[1].invocation.resultPresentation?.changes.length, 1)
})

test('patch groups same-file hunks into one display block', () => {
  const invocation = buildMultiFileWriteInvocation('patch', 'completed', [
    { fileName: 'src/example.ts', kind: 'update', oldContent: 'one\n', newContent: 'ONE\n' },
    { fileName: 'src/example.ts', kind: 'update', oldContent: 'two\n', newContent: 'TWO\n' },
    { fileName: 'src/example.ts', kind: 'update', oldContent: 'three\n', newContent: 'THREE\n' },
  ])

  const displayEntries = getToolInvocationDisplayEntries(invocation)
  assert.equal(displayEntries.length, 1)
  assert.equal(
    getToolInvocationHeaderLabel(displayEntries[0].invocation, undefined, WORKSPACE_ROOT_PATH),
    'Edited example.ts',
  )
  assert.equal(
    displayEntries[0].invocation.resultPresentation?.kind === 'change_diff'
      ? displayEntries[0].invocation.resultPresentation.changes.length
      : 0,
    3,
  )
  assert.equal(
    buildToolInvocationGroupSummary(displayEntries.map((entry) => entry.invocation)),
    'Edited 1 file',
  )
  assert.equal(
    buildToolInvocationGroupSummary(displayEntries.map((entry) => entry.invocation), 'Edited'),
    'Edited 1 file',
  )
})

test('patch reuses edit presentation for mixed multi-file changes', () => {
  const invocation = buildMultiFileWriteInvocation('patch', 'completed', [
    { fileName: 'src/edited.ts', kind: 'update', oldContent: 'before\n', newContent: 'after\n' },
    { fileName: 'src/created.ts', kind: 'add', oldContent: null, newContent: 'created\n' },
    { fileName: 'src/deleted.ts', kind: 'delete', oldContent: 'obsolete\n', newContent: '' },
  ])

  const displayEntries = getToolInvocationDisplayEntries(invocation)
  assert.equal(displayEntries.length, 3)
  assert.deepEqual(
    displayEntries.map((entry) => getToolInvocationHeaderLabel(entry.invocation, undefined, WORKSPACE_ROOT_PATH)),
    ['Edited edited.ts', 'Created created.ts', 'Deleted deleted.ts'],
  )
  assert.equal(
    buildToolInvocationGroupSummary(displayEntries.map((entry) => entry.invocation)),
    'Created 1 file, edited 1 file, deleted 1 file',
  )
  assert.deepEqual(
    getTerminalToolPresentationItems(invocation, WORKSPACE_ROOT_PATH).map((item) => item.label),
    ['Edited edited.ts', 'Created created.ts', 'Deleted deleted.ts'],
  )

  assert.deepEqual(getToolInvocationDisplayEntries({ ...invocation, state: 'running' }), [])
})

test('Code Mode expands an patch child into the same per-file edit presentation', () => {
  const changes = [
    { fileName: 'src/first.ts', kind: 'update' as const, oldContent: 'one\n', newContent: 'ONE\n' },
    { fileName: 'src/first.ts', kind: 'update' as const, oldContent: 'three\n', newContent: 'THREE\n' },
    { fileName: 'src/second.ts', kind: 'add' as const, oldContent: null, newContent: 'two\n' },
  ]
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ code: 'return await tools.patch({ patch: payloads.patch })' }),
    completedAt: 100,
    id: 'code-mode-apply-patch',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'tidecode.tool_result/v1',
        semantics: {
          operation: 'exec',
          tool_calls: [{
            arguments: { patch: ['*** Begin Patch', '*** End Patch'] },
            body: 'Patch applied successfully.',
            name: 'patch',
            result_presentation: { changes, kind: 'change_diff' },
            semantics: { added_path_count: 1, deleted_path_count: 0, operation: 'patch', updated_path_count: 1 },
            status: 'success',
            subject: { kind: 'workspace', path: 'workspace' },
            summary: 'Applied patch to 2 files',
          }],
        },
        status: 'success',
        subject: { kind: 'exec', path: 'local' },
        summary: 'Code Mode completed with 1 tool call.',
        toolCallId: 'code-mode-apply-patch',
        toolName: 'exec',
      },
      '{"done":true}',
    ),
    startedAt: 0,
    state: 'completed',
    toolName: 'exec',
  }

  const entries = getToolInvocationDisplayEntries(invocation)
  assert.deepEqual(entries.map((entry) => entry.invocation.toolName), ['patch', 'patch'])
  assert.deepEqual(
    entries.map((entry) => getToolInvocationHeaderLabel(entry.invocation, undefined, WORKSPACE_ROOT_PATH)),
    ['Edited first.ts', 'Created second.ts'],
  )
  assert.equal(
    entries[0].invocation.resultPresentation?.kind === 'change_diff'
      ? entries[0].invocation.resultPresentation.changes.length
      : 0,
    2,
  )
  assert.equal(buildToolInvocationGroupSummary(entries.map((entry) => entry.invocation)), 'Created 1 file, edited 1 file')
})

test('read tool header labels include the displayed file line range', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ path: TARGET_FILE_PATH }),
    id: 'tool-read-1',
    resultContent: formatStructuredToolResultContent(
      {
        arguments: {
          path: TARGET_FILE_PATH,
        },
        schema: 'tidecode.tool_result/v1',
        semantics: {
          end_line: 1,
          start_line: 1,
        },
        status: 'success',
        subject: {
          kind: 'file',
          path: 'src/example.ts',
        },
        summary: 'Read src/example.ts',
        toolCallId: 'tool-read-1',
        toolName: 'read',
      },
      '1: export const value = 1;',
    ),
    startedAt: 0,
    state: 'completed',
    toolName: 'read',
  }

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), 'Read example.ts (1-1)')
})

test('read tool header labels use the result range instead of the requested limit', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ limit: 2000, offset: 12, path: TARGET_FILE_PATH }),
    id: 'tool-read-range-1',
    resultContent: formatStructuredToolResultContent(
      {
        arguments: {
          limit: 2000,
          offset: 12,
          path: TARGET_FILE_PATH,
        },
        schema: 'tidecode.tool_result/v1',
        semantics: {
          end_line: 31,
          start_line: 12,
        },
        status: 'success',
        subject: {
          kind: 'file',
          path: 'src/example.ts',
        },
        summary: 'Read src/example.ts',
        toolCallId: 'tool-read-range-1',
        toolName: 'read',
      },
      '12: first\n31: last',
    ),
    startedAt: 0,
    state: 'completed',
    toolName: 'read',
  }

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), 'Read example.ts (12-31)')
})

test('empty list results keep the listed tool header', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({}),
    id: 'tool-list-empty-1',
    resultContent: formatStructuredToolResultContent(
      {
        arguments: {},
        schema: 'tidecode.tool_result/v1',
        semantics: {
          count: 0,
        },
        status: 'success',
        subject: {
          kind: 'directory',
          path: '.',
        },
        summary: 'Empty directory',
        toolCallId: 'tool-list-empty-1',
        toolName: 'list',
      },
      'Empty directory',
    ),
    startedAt: 0,
    state: 'completed',
    toolName: 'list',
  }

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), 'Listed .')
})

test('web search header labels use readable product wording', () => {
  const webSearchRunningInvocation: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-web-search-1',
    startedAt: 0,
    state: 'running',
    toolName: 'web_search',
  }

  const webSearchCompletedInvocation: ToolInvocationTrace = {
    ...webSearchRunningInvocation,
    state: 'completed',
  }

  assert.equal(getToolInvocationHeaderLabel(webSearchRunningInvocation, undefined, WORKSPACE_ROOT_PATH), 'Searching the web')
  assert.equal(getToolInvocationHeaderLabel(webSearchCompletedInvocation, undefined, WORKSPACE_ROOT_PATH), 'Searched the web')
  assert.deepEqual(getToolInvocationDisplayEntries(webSearchRunningInvocation), [])
  assert.deepEqual(
    getToolInvocationDisplayEntries(webSearchCompletedInvocation).map((entry) => entry.invocation.toolName),
    ['web_search'],
  )
})

test('MCP search headers show the exact query', () => {
  const runningInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      include_schema: false,
      limit: 5,
      query: 'send an invoice to a customer',
    }),
    id: 'tool-mcp-search-1',
    startedAt: 0,
    state: 'running',
    toolName: 'mcp_tool_search',
  }

  assert.equal(
    getToolInvocationHeaderLabel(runningInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Searching for MCP send an invoice to a customer',
  )
  assert.equal(
    getToolInvocationHeaderLabel({ ...runningInvocation, state: 'completed' }, undefined, WORKSPACE_ROOT_PATH),
    'Searched for MCP send an invoice to a customer',
  )
})

test('MCP execution headers use the discovered tool name and MCP marker in every state', () => {
  const runningInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      arguments: { customer: 'cus_123' },
      tool_id: 'mcp_stripe_create_invoice',
      tool_name: 'create_invoice',
    }),
    id: 'tool-mcp-execute-1',
    startedAt: 0,
    state: 'running',
    toolName: 'execute_mcp',
  }
  const completedInvocation: ToolInvocationTrace = {
    ...runningInvocation,
    resultContent: formatStructuredToolResultContent(
      {
        arguments: {
          arguments: { customer: 'cus_123' },
          tool_id: 'mcp_stripe_create_invoice',
        },
        schema: 'tidecode.tool_result/v1',
        semantics: {
          mcp_server_name: 'Stripe',
          mcp_tool_id: 'mcp_stripe_create_invoice',
          mcp_tool_name: 'create_invoice',
          operation: 'mcp_execute',
        },
        status: 'success',
        subject: {
          kind: 'mcp_tool',
          path: 'create_invoice',
        },
        summary: 'Ran create_invoice',
        toolCallId: 'tool-mcp-execute-1',
        toolName: 'execute_mcp',
      },
      'invoice created',
    ),
    state: 'completed',
  }

  assert.equal(
    getToolInvocationHeaderLabel(runningInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Running create_invoice mcp',
  )
  assert.equal(
    getToolInvocationHeaderLabel(completedInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Ran Stripe (create_invoice)',
  )
})

test('dynamic MCP execution headers show the MCP server with the tool name in parentheses', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ project_id: 'proj_123' }),
    id: 'tool-mcp-dynamic-1',
    resultContent: formatStructuredToolResultContent(
      {
        arguments: { project_id: 'proj_123' },
        schema: 'tidecode.tool_result/v1',
        semantics: {
          mcp_server_name: 'Routegate',
          mcp_tool_id: 'mcp_routegate_list_routes',
          mcp_tool_name: 'list_routes',
          operation: 'mcp_execute',
        },
        status: 'success',
        summary: 'Completed list_routes',
        toolCallId: 'tool-mcp-dynamic-1',
        toolName: 'mcp_routegate_list_routes',
      },
      'routes',
    ),
    startedAt: 0,
    state: 'completed',
    toolName: 'mcp_routegate_list_routes',
  }

  assert.equal(
    getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH),
    'Ran Routegate (list_routes)',
  )
})

test('terminal tool header labels keep internal session ids out of the user-facing header', () => {
  const commandInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      command: 'npm run test:unit',
      session_id: 7,
    }),
    id: 'tool-terminal-1',
    startedAt: 0,
    state: 'completed',
    toolName: 'terminal.execute',
  }

  const sessionInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      polling_ms: 2500,
      session_id: 7,
    }),
    id: 'tool-terminal-2',
    startedAt: 0,
    state: 'running',
    toolName: 'terminal.read',
  }

  assert.equal(
    getToolInvocationHeaderLabel(commandInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Started npm run test:unit',
  )
  assert.equal(
    getToolInvocationHeaderLabel(sessionInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Waiting for terminal',
  )
})

test('asynchronous terminal execution headers move from starting to started', () => {
  const runningInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ command: 'npm run lint' }),
    id: 'tool-terminal-execution-phase',
    startedAt: 1_000,
    state: 'running',
    toolName: 'terminal.execute',
  }

  assert.equal(
    getToolInvocationHeaderLabel(runningInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Starting npm run lint',
  )
  assert.equal(
    getToolInvocationHeaderLabel(
      { ...runningInvocation, state: 'completed' },
      undefined,
      WORKSPACE_ROOT_PATH,
    ),
    'Started npm run lint',
  )
})

test('terminal read and termination headers use bounded-wait action labels', () => {
  const terminationInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ session_id: 7 }),
    id: 'tool-terminal-termination-labels',
    startedAt: 0,
    state: 'running',
    toolName: 'terminal.terminate',
  }
  const readInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ session_id: 7 }),
    id: 'tool-terminal-read-labels',
    startedAt: 0,
    state: 'running',
    toolName: 'terminal.read',
  }

  assert.equal(getToolInvocationHeaderLabel(terminationInvocation), 'Terminating terminal')
  assert.equal(getToolInvocationHeaderLabel({ ...terminationInvocation, state: 'completed' }), 'Terminated terminal')
  assert.equal(getToolInvocationHeaderLabel(readInvocation), 'Waiting for terminal')
  assert.equal(getToolInvocationHeaderLabel({ ...readInvocation, state: 'completed' }), 'Read terminal')
  assert.equal(
    getToolInvocationHeaderLabel({
      ...readInvocation,
      argumentsText: JSON.stringify({ session_id: 7, wait_seconds: 0 }),
    }),
    'Reading terminal',
  )
})

test('terminal tool header labels preserve the full queued command text for UI truncation', () => {
  const command = 'Remove-Item -Force .git\\index.lock if (Test-Path .git\\index.lock) { Write-Host done }'
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      command,
    }),
    id: 'tool-terminal-3',
    startedAt: 0,
    state: 'completed',
    toolName: 'terminal.execute',
  }

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), `Started ${command}`)
})

test('skill tool header labels use activation wording and the skill name', () => {
  const runningInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      name: 'docx',
    }),
    id: 'tool-skill-1',
    startedAt: 0,
    state: 'running',
    toolName: 'skill.load',
  }

  assert.equal(
    getToolInvocationHeaderLabel(runningInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Loading skill docx',
  )
  assert.equal(
    getToolInvocationHeaderLabel({ ...runningInvocation, state: 'completed' }, undefined, WORKSPACE_ROOT_PATH),
    'Loaded skill docx',
  )
  assert.equal(
    getToolInvocationHeaderLabel({ ...runningInvocation, state: 'failed' }, undefined, WORKSPACE_ROOT_PATH),
    'Skill load failed docx',
  )
})


