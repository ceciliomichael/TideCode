import assert from 'node:assert/strict'
import test from 'node:test'
import { getAvailableApi } from '../../electron/chat/shared/ai/tools/available/get/get'
import type { AgentToolRegistryEntry } from '../../electron/chat/shared/tools/registry'

function contract(inputSchema: AgentToolRegistryEntry['inputSchema'], namespace = 'native') {
  return getAvailableApi({
    name: 'read', namespace, description: '# tools.read\n\nRead a file.', inputSchema,
    execute: async () => ({ status: 'success', summary: 'ok' }),
  } as AgentToolRegistryEntry, 'tools.read')
}

test('native tool contract is Markdown, includes typed fields, and omits duplicated schema JSON', () => {
  const result = contract({ type: 'object', required: ['path'], additionalProperties: false, properties: {
    path: { type: 'string', description: 'Exact path' },
    limit: { type: 'number', minimum: 1, maximum: 500 },
  } })
  assert.match(result, /^# tools\.read\n/u)
  assert.match(result, /"path": string/u)
  assert.match(result, /"limit"\?: number/u)
  assert.match(result, /minimum: 1/u)
  assert.doesNotMatch(result, /"inputSchema"|"additionalProperties"/u)
})

test('MCP tool contract preserves nested types and enum and array constraints', () => {
  const result = contract({ type: 'object', required: ['filter'], properties: {
    filter: { type: 'object', required: ['mode'], properties: {
      mode: { type: 'string', enum: ['exact', 'fuzzy'] },
      ids: { type: 'array', items: { type: 'integer' }, minItems: 1 },
    } },
  } }, 'mcp')
  assert.match(result, /"exact" \| "fuzzy"/u)
  assert.match(result, /\(number\)\[\]/u)
  assert.match(result, /minItems: 1/u)
  assert.match(result, /Promise<McpValue>/u)
})

test('unrepresentable JSON schema conditions survive in a JSON fallback', () => {
  const result = contract({ type: 'object', allOf: [{ required: ['x'] }], properties: { x: { type: 'string' } } })
  assert.match(result, /Complete input schema/u)
  assert.match(result, /"allOf"/u)
  assert.doesNotMatch(result, /## Parameters/u)
})

test('MCP referenced schemas retain exact constraints without duplicate parameter notes', () => {
  const result = contract({
    type: 'object',
    required: ['issue'],
    properties: { issue: { $ref: '#/$defs/Issue', description: 'Issue payload' } },
    $defs: { Issue: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 3 } } } },
  }, 'mcp')
  assert.match(result, /"issue": Issue/u)
  assert.match(result, /"\$ref": "#\/\$defs\/Issue"/u)
  assert.match(result, /"minLength": 3/u)
  assert.doesNotMatch(result, /## Parameters/u)
  assert.equal((result.match(/Issue payload/gu) ?? []).length, 1)
})

test('MCP simple schemas retain readable parameter notes without raw schema duplication', () => {
  const result = contract({ type: 'object', properties: {
    query: { type: 'string', description: 'Search phrase', minLength: 1 },
  } }, 'mcp')
  assert.match(result, /## Parameters/u)
  assert.match(result, /Search phrase/u)
  assert.doesNotMatch(result, /## Complete input schema/u)
})
