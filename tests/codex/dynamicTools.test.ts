import assert from 'node:assert/strict'
import test from 'node:test'
import { jsonSchema, NoSuchToolError, tool } from 'ai'
import { buildPromptContextManifest } from '../../electron/chat/cache/canonicalization'
import { buildDynamicToolCatalog } from '../../electron/chat/shared/tools/dynamicToolCatalog'
import {
  createDynamicToolSet,
  getDynamicToolInvocationProjection,
} from '../../electron/chat/shared/tools/dynamicTools'
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
    searchHints?: string[]
    tags?: string[]
  } = {},
): DynamicToolCatalogEntry {
  const nativeTool = tool({
    description,
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      type: 'object',
    }),
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
    inputSchema: {
      additionalProperties: false,
      properties: { path: { type: 'string' } },
      required: ['path'],
      type: 'object',
    },
    name: id,
    nativeTool,
    searchHints: options.searchHints ?? [],
    tags: options.tags ?? (id === 'read_file' ? ['filesystem'] : ['general']),
  }
}

test('dynamic tool set exposes exactly three model-facing tools', async () => {
  const tools = await createDynamicToolSet([
    createCatalogEntry('read_file', 'Read file contents'),
  ])

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
    { abortSignal: undefined, context: {}, messages: [], toolCallId: 'unknown-1' },
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
    error: new NoSuchToolError({ availableTools: [...DYNAMIC_TOOL_NAMES], toolName: 'read' }),
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
    error: new NoSuchToolError({ availableTools: [...DYNAMIC_TOOL_NAMES], toolName: 'execute_tool' }),
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
      execute: async () => ({ body: 'contents', status: 'success' as const, summary: 'Read file' }),
    }),
  })
  const tools = await createDynamicToolSet(catalog)
  const getSchema = tools.get_tool_schema.execute
  assert.ok(getSchema)

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

  const result = await getSchema({ ids: ['write_file', 'missing_tool', 'read_file'] })
  assert.equal(result.status, 'success')

  const body = JSON.parse(result.body ?? '{}') as {
    results?: Array<{
      error?: string
      id: string
      status: string
    }>
  }
  assert.deepEqual(body.results?.map((entry) => entry.id), ['write_file', 'missing_tool', 'read_file'])
  assert.deepEqual(body.results?.map((entry) => entry.status), ['success', 'error', 'success'])
  assert.match(body.results?.[1]?.error ?? '', /missing_tool/u)
})

test('schema fetch rejects empty or oversized batches', async () => {
  const tools = await createDynamicToolSet([createCatalogEntry('read_file', 'Read file contents')])
  const getSchema = tools.get_tool_schema.execute
  assert.ok(getSchema)

  const empty = await getSchema({ ids: [] })
  assert.equal(empty.status, 'error')
  assert.match(empty.body ?? '', /non-empty array/u)

  const oversized = await getSchema({ ids: Array.from({ length: DYNAMIC_SCHEMA_BATCH_SIZE + 1 }, (_, index) => `tool_${index}`) })
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
      searchHints: [
        'find authentication tokens API keys secrets credentials or other text in files',
      ],
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

  const invalid = await execute(
    { args: {}, id: 'read_file' },
    { abortSignal: undefined, context: {}, messages: [], toolCallId: 'outer-1' },
  )
  assert.equal(invalid.status, 'error')
  assert.match(invalid.body ?? '', /required/u)

  const valid = await execute(
    { args: { path: 'example.ts' }, id: 'read_file' },
    { abortSignal: undefined, context: {}, messages: [], toolCallId: 'outer-2' },
  )
  assert.equal(valid.status, 'success')
  assert.equal(valid.body, 'contents for example.ts')
  assert.equal(valid.resultPresentation?.kind, 'file_diff')
  assert.deepEqual(valid.dynamicInvocation, {
    argumentsValue: { path: 'example.ts' },
    toolName: 'read_file',
  })
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

  const resultContent = formatStructuredToolResultContent({
    arguments: { path: '/workspace/src/example.ts' },
    schema: 'echosphere.tool_result/v1',
    status: 'success',
    summary: 'Read src/example.ts',
    subject: { kind: 'file', path: 'src/example.ts' },
    toolCallId: 'outer-3',
    toolName: 'read',
  }, '1: value')
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
  const makeInvocation = (toolName: string, args: Record<string, unknown>, state: ToolInvocationTrace['state'] = 'completed') => ({
    argumentsText: JSON.stringify(args),
    id: `${toolName}-1`,
    startedAt: 0,
    state,
    toolName,
  }) satisfies ToolInvocationTrace

  assert.equal(getToolInvocationHeaderLabel(makeInvocation('list_tools', { query: 'read' })), 'Searched read in tool set')
  assert.equal(getToolInvocationHeaderLabel(makeInvocation('list_tools', {})), 'Listed tool set')
  assert.equal(getToolInvocationHeaderLabel(getInvocation('get_tool_schema', { id: 'read' })), 'Fetched schema for read')
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
