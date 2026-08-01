import assert from 'node:assert/strict'
import test from 'node:test'
import { asSchema, jsonSchema, NoSuchToolError, tool } from 'ai'
import { buildPromptContextManifest } from '../../electron/chat/cache/canonicalization'
import { buildDynamicToolCatalog } from '../../electron/chat/shared/tools/dynamicToolCatalog'
import { createDynamicToolSet, getDynamicToolInvocationProjection } from '../../electron/chat/shared/tools/dynamicTools'
import { repairDirectDynamicToolCall } from '../../electron/chat/shared/tools/dynamicToolRepair'
import {
  DYNAMIC_SCHEMA_BATCH_SIZE,
  DYNAMIC_TOOL_NAMES,
  type DynamicToolCatalogEntry,
} from '../../electron/chat/shared/tools/dynamicToolContracts'
import { searchToolCatalog } from '../../electron/chat/shared/tools/dynamicToolSearch'
import type { ToolInvocationTrace } from '../../src/types/chat'
import {
  getToolInvocationHeaderLabel,
  getToolInvocationDisplayEntries,
} from '../../src/components/chat/toolInvocationPresentation'
import { formatStructuredToolResultContent } from '../../src/lib/toolResultContent'

function createCatalogEntry(
  id: string,
  description: string,
  options: {
    aliases?: string[]
    inputSchema?: Record<string, unknown>
    searchHints?: string[]
    tags?: string[]
  } = {},
): DynamicToolCatalogEntry {
  const inputSchema = options.inputSchema ?? {
    additionalProperties: false,
    properties: {
      path: { type: 'string' },
    },
    required: ['path'],
    type: 'object',
  }
  const nativeTool = tool({
    description,
    inputSchema: jsonSchema(inputSchema),
    execute: async () => ({
      body: `executed ${id}`,
      status: 'success' as const,
      summary: `Completed ${id}`,
    }),
  })

  return {
    aliases: options.aliases ?? [id],
    description,
    execute: nativeTool.execute,
    guidance: {
      safety: [],
      whenToUse: description,
      workflow: [],
    },
    id,
    inputSchema,
    name: id,
    nativeTool,
    searchHints: options.searchHints ?? [],
    source: { kind: 'native' },
    tags: options.tags ?? (id === 'read_file' ? ['filesystem'] : ['general']),
  }
}

async function discoverTools(tools: Awaited<ReturnType<typeof createDynamicToolSet>>, query?: string) {
  const listTools = tools.list_tools.execute
  assert.ok(listTools)
  return listTools(query ? { page: 1, query } : { page: 1 })
}

async function discoverAndFetchSchema(tools: Awaited<ReturnType<typeof createDynamicToolSet>>, id: string) {
  await discoverTools(tools, id)
  const getSchema = tools.get_tool_schema.execute
  assert.ok(getSchema)
  const result = await getSchema({ id })
  assert.equal(result.status, 'success')
  return result
}

test('dynamic tool set exposes exactly three model-facing tools', async () => {
  const tools = await createDynamicToolSet([createCatalogEntry('read_file', 'Read file contents')])

  assert.deepEqual(Object.keys(tools).sort(), [...DYNAMIC_TOOL_NAMES].sort())
})

test('unknown execute ids return discovery guidance and ranked suggestions', async () => {
  const tools = await createDynamicToolSet([
    createCatalogEntry('list', 'List directory contents', {
      searchHints: ['list_dir', 'list directory contents'],
    }),
    createCatalogEntry('read', 'Read file contents'),
  ])
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  const result = await execute(
    { args: {}, id: 'list_dir' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'unknown-1',
    },
  )

  assert.equal(result.status, 'error')
  const body = JSON.parse(result.body ?? '{}') as {
    nextStep?: string
    suggestions?: Array<{ id: string }>
  }
  assert.match(body.nextStep ?? '', /list_tools.*get_tool_schema/u)
  assert.equal(body.suggestions?.[0]?.id, 'list')
})

test('direct native tool calls are repaired into discovery calls', async () => {
  const directCall = {
    input: JSON.stringify({ path: 'src/example.ts' }),
    toolCallId: 'direct-1',
    toolName: 'read',
    type: 'tool-call' as const,
  }
  const repaired = await repairDirectDynamicToolCall({
    error: new NoSuchToolError({
      availableTools: [...DYNAMIC_TOOL_NAMES],
      toolName: 'read',
    }),
    inputSchema: async () => ({ type: 'object' }),
    instructions: undefined,
    messages: [],
    system: undefined,
    toolCall: directCall,
    tools: {},
  })

  assert.deepEqual(repaired, {
    ...directCall,
    input: JSON.stringify({ query: 'read' }),
    toolName: 'list_tools',
  })

  const alreadyWrapped = await repairDirectDynamicToolCall({
    error: new NoSuchToolError({
      availableTools: [...DYNAMIC_TOOL_NAMES],
      toolName: 'execute_tool',
    }),
    inputSchema: async () => ({ type: 'object' }),
    instructions: undefined,
    messages: [],
    system: undefined,
    toolCall: {
      ...directCall,
      toolName: 'execute_tool',
    },
    tools: {},
  })
  assert.equal(alreadyWrapped, null)
})

test('schema fetch returns tool-specific guidance only after discovery', async () => {
  const catalog = await buildDynamicToolCatalog({
    read: tool({
      description: 'Read file contents',
      inputSchema: jsonSchema({
        properties: { path: { type: 'string' } },
        required: ['path'],
        type: 'object',
      }),
      execute: async () => ({
        body: 'contents',
        status: 'success' as const,
        summary: 'Read file',
      }),
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  const getSchema = tools.get_tool_schema.execute
  assert.ok(getSchema)

  const beforeDiscovery = await getSchema({ id: 'read' })
  assert.equal(beforeDiscovery.status, 'error')
  assert.match(beforeDiscovery.body ?? '', /TOOL_NOT_DISCOVERED/u)

  await discoverTools(tools, 'read')
  const result = await getSchema({ id: 'read' })
  assert.equal(result.status, 'success')
  const body = JSON.parse(result.body ?? '{}') as {
    guidance?: { whenToUse?: string; workflow?: string[] }
  }
  assert.equal(body.guidance?.whenToUse, 'Use to inspect the current contents of a file or directory.')
  assert.deepEqual(body.guidance?.workflow, [
    'Read an existing file immediately before editing it so the edit uses current contents.',
  ])
})

test('schema fetch batches independent tools in request order and reports missing ids', async () => {
  const tools = await createDynamicToolSet([
    createCatalogEntry('read_file', 'Read file contents'),
    createCatalogEntry('write_file', 'Write file contents'),
  ])
  const getSchema = tools.get_tool_schema.execute
  assert.ok(getSchema)

  await discoverTools(tools)
  const result = await getSchema({
    ids: ['write_file', 'missing_tool', 'read_file'],
  })
  assert.equal(result.status, 'success')

  const body = JSON.parse(result.body ?? '{}') as {
    results?: Array<{
      error?: string
      id: string
      status: string
    }>
  }
  assert.deepEqual(
    body.results?.map((entry) => entry.id),
    ['write_file', 'missing_tool', 'read_file'],
  )
  assert.deepEqual(
    body.results?.map((entry) => entry.status),
    ['success', 'error', 'success'],
  )
  assert.match(body.results?.[1]?.error ?? '', /missing_tool/u)
})

test('schema fetch rejects empty or oversized batches', async () => {
  const tools = await createDynamicToolSet([createCatalogEntry('read_file', 'Read file contents')])
  const getSchema = tools.get_tool_schema.execute
  assert.ok(getSchema)

  const empty = await getSchema({ ids: [] })
  assert.equal(empty.status, 'error')
  assert.match(empty.body ?? '', /non-empty array/u)

  const oversized = await getSchema({
    ids: Array.from({ length: DYNAMIC_SCHEMA_BATCH_SIZE + 1 }, (_, index) => `tool_${index}`),
  })
  assert.equal(oversized.status, 'error')
  assert.match(oversized.body ?? '', /max_batch_size/u)
})

test('dynamic search ranks semantic matches, tolerates typos, and paginates ten per page', () => {
  const catalog = [
    createCatalogEntry('read_file', 'Read and inspect UTF-8 file contents'),
    createCatalogEntry('execute_terminal', 'Run shell commands and inspect terminal sessions'),
    ...Array.from({ length: 18 }, (_, index) => createCatalogEntry(`tool_${index + 1}`, `Generic tool ${index + 1}`)),
  ]

  const searchPage = searchToolCatalog(catalog, 'inspect file contnts', 1)
  assert.equal(searchPage.pageSize, 10)
  assert.equal(searchPage.results[0]?.id, 'read_file')
  assert.ok(searchPage.totalMatches >= 1)

  const firstPage = searchToolCatalog(catalog, undefined, 1)
  const secondPage = searchToolCatalog(catalog, undefined, 2)
  assert.equal(firstPage.results.length, 10)
  assert.equal(secondPage.results.length, 10)
  assert.equal(firstPage.hasMore, true)
  assert.equal(secondPage.hasMore, false)
  assert.notEqual(firstPage.results[0]?.id, secondPage.results[0]?.id)
})

test('dynamic search uses semantic hints for natural-language intent', () => {
  const catalog = [
    createCatalogEntry('grep', 'Search text and regular expressions in files', {
      aliases: ['grep', 'text search', 'pattern search'],
      searchHints: ['find authentication tokens API keys secrets credentials or other text in files'],
      tags: ['filesystem', 'search'],
    }),
    createCatalogEntry('read', 'Read file contents', {
      searchHints: ['open inspect or view source code'],
      tags: ['filesystem'],
    }),
    createCatalogEntry('glob', 'Find files by name', {
      searchHints: ['locate files and directories'],
      tags: ['filesystem', 'search'],
    }),
  ]

  const searchPage = searchToolCatalog(catalog, 'find auth tokens if used')
  assert.equal(searchPage.results[0]?.id, 'grep')

  const fuzzySearchPage = searchToolCatalog(catalog, 'find authentcation toknes if used')
  assert.equal(fuzzySearchPage.results[0]?.id, 'grep')
})

test('dynamic search separates similar capabilities and ignores context-only queries', () => {
  const catalog = [
    createCatalogEntry('apply_patch', 'Apply coordinated patch changes', {
      searchHints: [
        'apply a unified diff or patch text',
        'edit multiple files in one operation',
        'perform bulk code changes or a multi-file refactor',
      ],
    }),
    createCatalogEntry('execute_terminal', 'Run commands in a terminal', {
      searchHints: ['run shell commands', 'run tests builds and scripts', 'inspect terminal output'],
    }),
    createCatalogEntry('edit', 'Make a precise change to an existing file', {
      searchHints: ['replace exact text in an existing file', 'change a specific file section'],
    }),
    createCatalogEntry('grep', 'Search text inside file contents', {
      searchHints: ['find text in files', 'find function definitions symbols references and regex matches'],
    }),
    createCatalogEntry('glob', 'Find files by name', {
      searchHints: ['find files by name filename extension or wildcard', 'locate matching file paths'],
    }),
    createCatalogEntry('kanban_board', 'Manage project tasks', {
      searchHints: ['manage project tasks and work items', 'create update move or delete kanban cards'],
    }),
    createCatalogEntry('read', 'Read current file contents', {
      searchHints: ['open look at inspect view show or display source code', 'read a file before editing it'],
    }),
    createCatalogEntry('skill', 'Load specialized instructions', {
      searchHints: ['load a playbook workflow or specialized capability', 'activate instructions before a task'],
    }),
    createCatalogEntry('web_search', 'Search the internet', {
      searchHints: ['look up current latest recent information online', 'find external web sources'],
    }),
    createCatalogEntry('write', 'Write complete file contents', {
      searchHints: ['create a new file', 'write save overwrite or rewrite an entire file'],
    }),
  ]

  const expectedMatches: Array<[string, string]> = [
    ['apply multi-file patch', 'apply_patch'],
    ['change exact text', 'edit'],
    ['find file by name', 'glob'],
    ['find function definition', 'grep'],
    ['load specialized instructions', 'skill'],
    ['manage project tasks', 'kanban_board'],
    ['read current file', 'read'],
    ['run tests', 'execute_terminal'],
    ['search latest news online', 'web_search'],
    ['create new file', 'write'],
  ]

  for (const [query, expectedId] of expectedMatches) {
    const result = searchToolCatalog(catalog, query)
    assert.equal(result.results[0]?.id, expectedId, `Expected ${expectedId} to lead for ${query}`)
    assert.ok(result.totalMatches >= 1, `Expected at least one result for ${query}`)
  }

  const contextOnlyResult = searchToolCatalog(catalog, 'files')
  assert.equal(contextOnlyResult.totalMatches, 0)

  const terminalResult = searchToolCatalog(catalog, 'run tests')
  assert.ok(!terminalResult.results.some((result) => result.id === 'read'))
  assert.ok(!terminalResult.results.some((result) => result.id === 'write'))
})

test('dynamic catalogs infer semantic hints for custom tool descriptions', async () => {
  const catalog = await buildDynamicToolCatalog({
    inspect_logs: tool({
      description: 'Searches file contents using regular expressions.',
      inputSchema: jsonSchema({ type: 'object' }),
      execute: async () => ({ status: 'success' as const, summary: 'Searched logs' }),
    }),
    run_command: tool({
      description: 'Runs shell commands and scripts in a persistent session.',
      inputSchema: jsonSchema({ type: 'object' }),
      execute: async () => ({ status: 'success' as const, summary: 'Ran command' }),
    }),
  })

  const logTool = catalog.find((entry) => entry.id === 'inspect_logs')
  const commandTool = catalog.find((entry) => entry.id === 'run_command')
  assert.ok(logTool?.searchHints.some((hint) => hint.includes('regular expressions inside file contents')))
  assert.ok(commandTool?.searchHints.some((hint) => hint.includes('shell commands scripts tests builds')))
})

test('execute_tool validates nested arguments and preserves native result metadata', async () => {
  const catalog = await buildDynamicToolCatalog({
    read_file: tool({
      description: 'Read file contents',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
        type: 'object',
      }),
      execute: async (input) => ({
        body: `contents for ${(input as { path: string }).path}`,
        resultPresentation: {
          fileName: 'example.ts',
          kind: 'file_diff' as const,
          newContent: 'next',
          oldContent: 'previous',
        },
        status: 'success' as const,
        summary: 'Read file',
      }),
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  const knownFromHistory = await execute(
    { args: { path: 'example.ts' }, id: 'read_file' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'history-known-1',
    },
  )
  assert.equal(knownFromHistory.status, 'success')
  assert.equal(knownFromHistory.body, 'contents for example.ts')

  await discoverAndFetchSchema(tools, 'read_file')
  const invalid = await execute(
    { args: {}, id: 'read_file' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'outer-1',
    },
  )
  assert.equal(invalid.status, 'error')
  assert.match(invalid.body ?? '', /required/u)

  const valid = await execute(
    { args: { path: 'example.ts' }, id: 'read_file' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'outer-2',
    },
  )
  assert.equal(valid.status, 'success')
  assert.equal(valid.body, 'contents for example.ts')
  assert.equal(valid.resultPresentation?.kind, 'file_diff')
  assert.deepEqual(valid.dynamicInvocation, {
    argumentsValue: { path: 'example.ts' },
    toolName: 'read_file',
  })
})

test('execute_tool keeps the top-level contract and repairs one legacy outer args wrapper', async () => {
  const catalog = await buildDynamicToolCatalog({
    read_file: tool({
      description: 'Read file contents',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
        type: 'object',
      }),
      execute: async (input) => ({
        body: `contents for ${(input as { path: string }).path}`,
        status: 'success' as const,
        summary: 'Read file',
      }),
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  await discoverAndFetchSchema(tools, 'read_file')

  const execute = tools.execute_tool.execute
  assert.ok(execute)
  const legacyWrappedResult = await execute(
    { args: { args: { path: 'example.ts' }, id: 'read_file' } },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'legacy-wrapper-1',
    },
  )
  assert.equal(legacyWrappedResult.status, 'success')
  assert.equal(legacyWrappedResult.body, 'contents for example.ts')

  const duplicateIdWrappedResult = await execute(
    { args: { args: { path: 'example.ts' }, id: 'read_file' }, id: 'read_file' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'legacy-duplicate-id-wrapper-1',
    },
  )
  assert.equal(duplicateIdWrappedResult.status, 'success')
  assert.equal(duplicateIdWrappedResult.body, 'contents for example.ts')

  const doublyWrappedResult = await execute(
    { args: { args: { args: { path: 'example.ts' }, id: 'read_file' } } },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'legacy-double-wrapper-1',
    },
  )
  assert.equal(doublyWrappedResult.status, 'success')
  assert.equal(doublyWrappedResult.body, 'contents for example.ts')

  const flattenedLegacyResult = await execute(
    { args: { id: 'read_file', path: 'example.ts' } },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'legacy-flattened-wrapper-1',
    },
  )
  assert.equal(flattenedLegacyResult.status, 'success')
  assert.equal(flattenedLegacyResult.body, 'contents for example.ts')

  const executeSchema = asSchema(tools.execute_tool.inputSchema)
  assert.ok(executeSchema.validate)
  const normalized = await executeSchema.validate({
    args: { args: { path: 'example.ts' }, id: 'read_file' },
  })
  assert.equal(normalized.success, true)
  if (normalized.success) {
    assert.deepEqual(normalized.value, {
      args: { path: 'example.ts' },
      id: 'read_file',
    })
  }

  const normalizedDuplicateId = await executeSchema.validate({
    args: { args: { path: 'example.ts' }, id: 'read_file' },
    id: 'read_file',
  })
  assert.equal(normalizedDuplicateId.success, true)
  if (normalizedDuplicateId.success) {
    assert.deepEqual(normalizedDuplicateId.value, {
      args: { path: 'example.ts' },
      id: 'read_file',
    })
  }

  const normalizedDoublyWrapped = await executeSchema.validate({
    args: { args: { args: { path: 'example.ts' }, id: 'read_file' } },
  })
  assert.equal(normalizedDoublyWrapped.success, true)
  if (normalizedDoublyWrapped.success) {
    assert.deepEqual(normalizedDoublyWrapped.value, {
      args: { path: 'example.ts' },
      id: 'read_file',
    })
  }

  const normalizedFlattened = await executeSchema.validate({
    args: { id: 'read_file', path: 'example.ts' },
  })
  assert.equal(normalizedFlattened.success, true)
  if (normalizedFlattened.success) {
    assert.deepEqual(normalizedFlattened.value, {
      args: { path: 'example.ts' },
      id: 'read_file',
    })
  }

  const extraOuterField = await executeSchema.validate({
    args: { args: { path: 'example.ts' }, id: 'read_file' },
    unexpected: true,
  })
  assert.equal(extraOuterField.success, false)
})

test('execute_tool enforces full JSON Schema references and oneOf semantics before dispatch', async () => {
  let executionCount = 0
  const catalog = await buildDynamicToolCatalog({
    exact_choice: tool({
      description: 'Execute one exact payload shape',
      inputSchema: jsonSchema({
        $defs: {
          payload: {
            oneOf: [
              { required: ['left'], type: 'object' },
              { required: ['right'], type: 'object' },
            ],
            properties: {
              left: { type: 'string' },
              right: { type: 'string' },
            },
            type: 'object',
          },
        },
        additionalProperties: false,
        properties: {
          payload: { $ref: '#/$defs/payload' },
        },
        required: ['payload'],
        type: 'object',
      }),
      execute: async () => {
        executionCount += 1
        return { status: 'success' as const, summary: 'Executed exact choice' }
      },
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  await discoverAndFetchSchema(tools, 'exact_choice')
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  const result = await execute(
    { args: { payload: { left: 'a', right: 'b' } }, id: 'exact_choice' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'one-of-invalid',
    },
  )

  assert.equal(result.status, 'error')
  assert.match(result.body ?? '', /INVALID_ARGUMENTS/u)
  assert.equal(executionCount, 0)
})

test('execute_tool accepts flattened edit arguments from a nested wrapper', async () => {
  const catalog = await buildDynamicToolCatalog({
    edit: tool({
      description: 'Apply exact edits to a file',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          edits: {
            items: { type: 'object' },
            minItems: 1,
            type: 'array',
          },
          path: { type: 'string' },
        },
        required: ['path', 'edits'],
        type: 'object',
      }),
      execute: async (input) => ({
        body: `${(input as { path: string }).path}:${(input as { edits: unknown[] }).edits.length}`,
        status: 'success' as const,
        summary: 'Applied edits',
      }),
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  const result = await execute(
    {
      args: {
        edits: [{ replacementContent: 'new', targetContent: 'old' }],
        id: 'edit',
        path: 'src/example.ts',
      },
    },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'flattened-edit-wrapper-1',
    },
  )

  assert.equal(result.status, 'success')
  assert.equal(result.body, 'src/example.ts:1')
})

test('execute_tool normalizes same-path batch edit items into the shared top-level path shape', async () => {
  let receivedArguments: Record<string, unknown> | undefined
  const catalog = await buildDynamicToolCatalog({
    edit: tool({
      description: 'Apply exact edits to one file',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          edits: {
            items: {
              additionalProperties: false,
              properties: {
                replacementContent: { type: 'string' },
                targetContent: { minLength: 1, type: 'string' },
              },
              required: ['targetContent', 'replacementContent'],
              type: 'object',
            },
            minItems: 1,
            type: 'array',
          },
          path: { type: 'string' },
        },
        required: ['path', 'edits'],
        type: 'object',
      }),
      execute: async (input) => {
        receivedArguments = input as Record<string, unknown>
        return {
          body: `${receivedArguments.path as string}:${(receivedArguments.edits as unknown[]).length}`,
          status: 'success' as const,
          summary: 'Applied edits',
        }
      },
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  const rawArguments = {
    edits: [
      { path: 'src/example.ts', replacementContent: 'new one', targetContent: 'old one' },
      { path: 'src/example.ts', replacementContent: 'new two', targetContent: 'old two' },
    ],
  }
  const result = await execute(
    { args: rawArguments, id: 'edit' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'edit-item-paths-1',
    },
  )

  assert.equal(result.status, 'success')
  assert.equal(result.body, 'src/example.ts:2')
  assert.deepEqual(receivedArguments, {
    edits: [
      { replacementContent: 'new one', targetContent: 'old one' },
      { replacementContent: 'new two', targetContent: 'old two' },
    ],
    path: 'src/example.ts',
  })
  assert.deepEqual(result.dynamicInvocation, {
    argumentsValue: rawArguments,
    toolName: 'edit',
  })

  const differentPathsResult = await execute(
    {
      args: {
        edits: [
          { path: 'src/one.ts', replacementContent: 'new one', targetContent: 'old one' },
          { path: 'src/two.ts', replacementContent: 'new two', targetContent: 'old two' },
        ],
      },
      id: 'edit',
    },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'edit-item-paths-2',
    },
  )
  assert.equal(differentPathsResult.status, 'error')
  const differentPathsBody = JSON.parse(differentPathsResult.body ?? '{}') as { missing?: string[] }
  assert.deepEqual(differentPathsBody.missing, ['path'])
})

test('execute_tool accepts write file as a compatibility alias for path', async () => {
  let receivedArguments: Record<string, unknown> | undefined
  const catalog = await buildDynamicToolCatalog({
    write: tool({
      description: 'Write complete file contents. Use path for the destination.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['path', 'content'],
        type: 'object',
      }),
      execute: async (input) => {
        const argumentsValue = input as Record<string, unknown>
        receivedArguments = argumentsValue
        return {
          body: `wrote ${argumentsValue.path as string}`,
          status: 'success' as const,
          summary: 'Wrote file',
        }
      },
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  const rawArguments = {
    content: '<html></html>',
    file: 'minecraft-clone/index.html',
  }
  const result = await execute(
    { args: rawArguments, id: 'write' },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'write-file-alias-1',
    },
  )

  assert.equal(result.status, 'success')
  assert.equal(result.body, 'wrote minecraft-clone/index.html')
  assert.deepEqual(receivedArguments, {
    content: '<html></html>',
    path: 'minecraft-clone/index.html',
  })
  assert.deepEqual(result.dynamicInvocation, {
    argumentsValue: rawArguments,
    toolName: 'write',
  })
})

test('edit argument errors explain how to recover without exposing a schema dump', async () => {
  const tools = await createDynamicToolSet([
    createCatalogEntry('edit', 'Edit one exact block in a file', {
      inputSchema: {
        oneOf: [
          {
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              replacementContent: { type: 'string' },
              targetContent: { minLength: 1, type: 'string' },
            },
            required: ['path', 'targetContent', 'replacementContent'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              edits: { minItems: 1, type: 'array' },
              path: { type: 'string' },
            },
            required: ['path', 'edits'],
            type: 'object',
          },
        ],
        type: 'object',
      },
    }),
  ])
  const execute = tools.execute_tool.execute
  assert.ok(execute)

  await discoverAndFetchSchema(tools, 'edit')
  const result = await execute(
    {
      args: { path: 'src/example.ts', replacementContent: 'next' },
      id: 'edit',
    },
    {
      abortSignal: undefined,
      context: {},
      messages: [],
      toolCallId: 'edit-invalid-1',
    },
  )

  assert.equal(result.status, 'error')
  const body = JSON.parse(result.body ?? '{}') as {
    changed?: boolean
    code?: string
    missing?: string[]
    nextStep?: string
    schema?: unknown
  }
  assert.equal(body.code, 'INVALID_ARGUMENTS')
  assert.deepEqual(body.missing, ['targetContent'])
  assert.equal(body.changed, false)
  assert.match(body.nextStep ?? '', /Read the file.*targetContent/u)
  assert.equal(body.schema, undefined)
})

test('dynamic invocation projection delegates presentation to the discovered native tool', () => {
  const wrapperArguments = JSON.stringify({
    args: { path: '/workspace/src/example.ts' },
    id: 'read',
  })
  const projected = getDynamicToolInvocationProjection('execute_tool', JSON.parse(wrapperArguments))
  assert.deepEqual(projected, {
    argumentsValue: { path: '/workspace/src/example.ts' },
    toolName: 'read',
  })

  const resultContent = formatStructuredToolResultContent(
    {
      arguments: { path: '/workspace/src/example.ts' },
      schema: 'tidecode.tool_result/v1',
      status: 'success',
      summary: 'Read src/example.ts',
      subject: { kind: 'file', path: 'src/example.ts' },
      toolCallId: 'outer-3',
      toolName: 'read',
    },
    '1: value',
  )
  const invocation: ToolInvocationTrace = {
    argumentsText: wrapperArguments,
    id: 'outer-3',
    resultContent,
    startedAt: 0,
    state: 'completed',
    toolName: 'execute_tool',
  }

  assert.equal(getToolInvocationHeaderLabel(invocation, undefined, '/workspace'), 'Read example.ts')
  assert.equal(getToolInvocationDisplayEntries(invocation)[0]?.invocation.toolName, 'read')
})

test('meta-tool presentation uses the user-facing discovery language', () => {
  const makeInvocation = (
    toolName: string,
    args: Record<string, unknown>,
    state: ToolInvocationTrace['state'] = 'completed',
  ) =>
    ({
      argumentsText: JSON.stringify(args),
      id: `${toolName}-1`,
      startedAt: 0,
      state,
      toolName,
    }) satisfies ToolInvocationTrace

  assert.equal(
    getToolInvocationHeaderLabel(makeInvocation('list_tools', { query: 'read' })),
    'Searched read in tool set',
  )
  assert.equal(getToolInvocationHeaderLabel(makeInvocation('list_tools', {})), 'Listed tool set')
  assert.equal(
    getToolInvocationHeaderLabel(getInvocation('get_tool_schema', { id: 'read' })),
    'Fetched schema for read',
  )
  assert.equal(
    getToolInvocationHeaderLabel(getInvocation('get_tool_schema', { ids: ['read', 'write'] })),
    'Fetched schemas for read, write',
  )
})

test('private catalog changes do not change the provider-facing prompt fingerprint', async () => {
  const [toolsWithOneEntry, toolsWithTwoEntries] = await Promise.all([
    createDynamicToolSet([createCatalogEntry('read', 'Read file contents')]),
    createDynamicToolSet([
      createCatalogEntry('read', 'Read file contents'),
      createCatalogEntry('write', 'Write complete file contents'),
    ]),
  ])

  const manifestForOneEntry = buildPromptContextManifest({
    modelId: 'test-model',
    providerId: 'custom:test-provider',
    system: 'stable system prompt',
    tools: toolsWithOneEntry,
  })
  const manifestForTwoEntries = buildPromptContextManifest({
    modelId: 'test-model',
    providerId: 'custom:test-provider',
    system: 'stable system prompt',
    tools: toolsWithTwoEntries,
  })

  assert.equal(manifestForOneEntry.fingerprint, manifestForTwoEntries.fingerprint)
  assert.equal(manifestForOneEntry.toolsHash, manifestForTwoEntries.toolsHash)
})

function getInvocation(toolName: string, args: Record<string, unknown>) {
  return {
    argumentsText: JSON.stringify(args),
    id: `${toolName}-2`,
    startedAt: 0,
    state: 'completed' as const,
    toolName,
  }
}
