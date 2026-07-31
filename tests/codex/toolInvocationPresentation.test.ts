import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolInvocationTrace } from '../../src/types/chat'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'
import {
  getToolInvocationDisplayEntries,
  getToolInvocationHeaderLabel,
} from '../../src/components/chat/toolInvocationPresentation'

const WORKSPACE_ROOT_PATH = '/workspace'
const TARGET_FILE_PATH = `${WORKSPACE_ROOT_PATH}/src/example.ts`

function buildFileChangeInvocation(
  kind: 'add' | 'delete' | 'update',
  state: ToolInvocationTrace['state'],
  overrides?: Partial<ToolInvocationTrace>,
) {
  const semanticsByKind = {
    add: {
      added_path_count: 1,
      deleted_path_count: 0,
      operation: 'edit',
      updated_path_count: 0,
    },
    delete: {
      added_path_count: 0,
      deleted_path_count: 1,
      operation: 'edit',
      updated_path_count: 0,
    },
    update: {
      added_path_count: 0,
      deleted_path_count: 0,
      operation: 'edit',
      updated_path_count: 1,
    },
  } as const

  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ path: TARGET_FILE_PATH }),
    id: 'tool-1',
    resultContent: formatStructuredToolResultContent(
      {
        schema: 'echosphere.tool_result/v1',
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
  toolName: 'write' | 'apply_patch',
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
        schema: 'echosphere.tool_result/v1',
        semantics: {
          added_path_count: changes.filter((change) => change.kind === 'add').length,
          deleted_path_count: changes.filter((change) => change.kind === 'delete').length,
          operation: 'edit',
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
        schema: 'echosphere.tool_result/v1',
        semantics: {
          added_path_count: 1,
          deleted_path_count: 0,
          operation: 'edit',
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
  const runningApplyPatchInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      patchText: [
        '<patch>',
        '<update path="src/example.ts">',
        '@@',
        '-const value = 1;',
        '+const value = 2;',
        '</patch>',
      ].join('\n'),
    }),
    id: 'tool-apply-running-single',
    startedAt: 0,
    state: 'running',
    toolName: 'apply_patch',
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

  assert.deepEqual(getToolInvocationDisplayEntries(runningApplyPatchInvocation), [])
  assert.deepEqual(getToolInvocationDisplayEntries(runningWriteInvocation), [])
})

test('multi-file apply_patch invocations stay hidden until they complete', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      patchText: [
        '<patch>',
        '<update path="src/first.ts">',
        '@@',
        '-const first = 1;',
        '+const first = 2;',
        '<update path="src/second.ts">',
        '@@',
        '-const second = 1;',
        '+const second = 2;',
        '</patch>',
      ].join('\n'),
    }),
    id: 'tool-apply-running-multi',
    startedAt: 0,
    state: 'running',
    toolName: 'apply_patch',
  }

  assert.deepEqual(getToolInvocationDisplayEntries(invocation), [])
})

test('multi-file apply_patch invocations expand into separate display blocks', () => {
  const invocation = buildMultiFileWriteInvocation('apply_patch', 'completed', [
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

test('read tool header labels collapse to the basename for the visible toolblock', () => {
  const invocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({ path: TARGET_FILE_PATH }),
    id: 'tool-read-1',
    resultContent: formatStructuredToolResultContent(
      {
        arguments: {
          path: TARGET_FILE_PATH,
        },
        schema: 'echosphere.tool_result/v1',
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

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), 'Read example.ts')
})

test('kanban tool header labels use kanban-specific verbs', () => {
  const readBoardRunning: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-kanban-read-board',
    startedAt: 0,
    state: 'running',
    toolName: 'read_board',
  }

  const readBoardCompleted: ToolInvocationTrace = {
    ...readBoardRunning,
    state: 'completed',
  }

  const readCardRunning: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-kanban-read-card',
    startedAt: 0,
    state: 'running',
    toolName: 'read_card',
  }

  const readCardCompleted: ToolInvocationTrace = {
    ...readCardRunning,
    state: 'completed',
  }

  const createCardRunning: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-kanban-create-card',
    startedAt: 0,
    state: 'running',
    toolName: 'create_card',
  }

  const createCardCompleted: ToolInvocationTrace = {
    ...createCardRunning,
    state: 'completed',
  }

  const updateCardRunning: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-kanban-update-card',
    startedAt: 0,
    state: 'running',
    toolName: 'update_card',
  }

  const updateCardCompleted: ToolInvocationTrace = {
    ...updateCardRunning,
    state: 'completed',
  }

  const moveCardRunning: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-kanban-move-card',
    startedAt: 0,
    state: 'running',
    toolName: 'move_card',
  }

  const moveCardCompleted: ToolInvocationTrace = {
    ...moveCardRunning,
    state: 'completed',
  }

  const reorderCardRunning: ToolInvocationTrace = {
    argumentsText: '{}',
    id: 'tool-kanban-reorder-card',
    startedAt: 0,
    state: 'running',
    toolName: 'reorder_card',
  }

  const reorderCardCompleted: ToolInvocationTrace = {
    ...reorderCardRunning,
    state: 'completed',
  }

  assert.equal(getToolInvocationHeaderLabel(readBoardRunning, undefined, WORKSPACE_ROOT_PATH), 'Reading board')
  assert.equal(getToolInvocationHeaderLabel(readBoardCompleted, undefined, WORKSPACE_ROOT_PATH), 'Read board')
  assert.equal(getToolInvocationHeaderLabel(readCardRunning, undefined, WORKSPACE_ROOT_PATH), 'Reading card')
  assert.equal(getToolInvocationHeaderLabel(readCardCompleted, undefined, WORKSPACE_ROOT_PATH), 'Read card')
  assert.equal(getToolInvocationHeaderLabel(createCardRunning, undefined, WORKSPACE_ROOT_PATH), 'Creating card')
  assert.equal(getToolInvocationHeaderLabel(createCardCompleted, undefined, WORKSPACE_ROOT_PATH), 'Created card')
  assert.equal(getToolInvocationHeaderLabel(updateCardRunning, undefined, WORKSPACE_ROOT_PATH), 'Updating card')
  assert.equal(getToolInvocationHeaderLabel(updateCardCompleted, undefined, WORKSPACE_ROOT_PATH), 'Updated card')
  assert.equal(getToolInvocationHeaderLabel(moveCardRunning, undefined, WORKSPACE_ROOT_PATH), 'Moving card')
  assert.equal(getToolInvocationHeaderLabel(moveCardCompleted, undefined, WORKSPACE_ROOT_PATH), 'Moved card')
  assert.equal(getToolInvocationHeaderLabel(reorderCardRunning, undefined, WORKSPACE_ROOT_PATH), 'Reordering card')
  assert.equal(getToolInvocationHeaderLabel(reorderCardCompleted, undefined, WORKSPACE_ROOT_PATH), 'Reordered card')
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
})

test('terminal tool header labels prefer the queued command and fall back to the session id', () => {
  const commandInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      command: 'npm run test:unit',
      session_id: 7,
    }),
    id: 'tool-terminal-1',
    startedAt: 0,
    state: 'completed',
    toolName: 'execute_terminal',
  }

  const sessionInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      polling_ms: 2500,
      session_id: 7,
    }),
    id: 'tool-terminal-2',
    startedAt: 0,
    state: 'running',
    toolName: 'get_terminal_output',
  }

  assert.equal(
    getToolInvocationHeaderLabel(commandInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Ran npm run test:unit',
  )
  assert.equal(
    getToolInvocationHeaderLabel(sessionInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Polling session 7',
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
    toolName: 'execute_terminal',
  }

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, WORKSPACE_ROOT_PATH), `Ran ${command}`)
})

test('skill tool header labels use activation wording and the skill name', () => {
  const runningInvocation: ToolInvocationTrace = {
    argumentsText: JSON.stringify({
      name: 'docx',
    }),
    id: 'tool-skill-1',
    startedAt: 0,
    state: 'running',
    toolName: 'skill',
  }

  assert.equal(
    getToolInvocationHeaderLabel(runningInvocation, undefined, WORKSPACE_ROOT_PATH),
    'Activating Skill docx',
  )
  assert.equal(
    getToolInvocationHeaderLabel({ ...runningInvocation, state: 'completed' }, undefined, WORKSPACE_ROOT_PATH),
    'Activated Skill docx',
  )
  assert.equal(
    getToolInvocationHeaderLabel({ ...runningInvocation, state: 'failed' }, undefined, WORKSPACE_ROOT_PATH),
    'Skill activation failed docx',
  )
})
