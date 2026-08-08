import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MCP_VALIDATION_ERRORS,
  parseMcpAddServerInput,
  parseMcpSettings,
  validateServerConfig,
} from '../../electron/mcp/configValidation'

test('parseMcpSettings validates and sanitizes stdio server configs', () => {
  const parsed = parseMcpSettings(`{
    "mcpServers": {
      "local-server": {
        "command": "node",
        "args": ["server.js", "", null],
        "env": {
          "API_KEY": "  secret  ",
          "EMPTY": "   "
        },
        "disabled": false
      }
    }
  }`)

  assert.equal(parsed.success, true)
  assert.deepEqual(parsed.data?.mcpServers['local-server'], {
    args: ['server.js'],
    command: 'node',
    disabled: false,
    env: { API_KEY: 'secret' },
    type: 'stdio',
  })
})

test('validateServerConfig rejects mixed command and url transport fields', () => {
  assert.throws(
    () =>
      validateServerConfig({
        command: 'node',
        type: 'streamable-http',
        url: 'https://example.com/mcp',
      }),
    new RegExp(MCP_VALIDATION_ERRORS.MIXED_FIELDS_ERROR),
  )
})

test('validateServerConfig requires explicit url transport type', () => {
  assert.throws(
    () =>
      validateServerConfig({
        url: 'https://example.com/mcp',
      }),
    new RegExp(MCP_VALIDATION_ERRORS.URL_TYPE_REQUIRED),
  )
})

test('validateServerConfig preserves safe TideCode identity metadata and drops malformed metadata', () => {
  const parsed = validateServerConfig({
    command: 'node',
    tidecodeId: 'mcp-github-1234abcd',
    tidecodeToolNamespace: 'github',
    type: 'stdio',
  })

  assert.equal(parsed.tidecodeId, 'mcp-github-1234abcd')
  assert.equal(parsed.tidecodeToolNamespace, 'github')

  const sanitized = validateServerConfig({
    command: 'node',
    tidecodeId: 'not-an-mcp-id',
    tidecodeToolNamespace: 'github namespace',
    type: 'stdio',
  })

  assert.equal(sanitized.tidecodeId, undefined)
  assert.equal(sanitized.tidecodeToolNamespace, undefined)
})

test('parseMcpAddServerInput normalizes stdio server entries', () => {
  const parsed = parseMcpAddServerInput({
    args: ['server.js', ''],
    command: ' node ',
    env: {
      API_KEY: '  secret  ',
      EMPTY: '   ',
    },
    serverName: ' local-server ',
    type: 'stdio',
  })

  assert.equal(parsed.success, true)
  assert.deepEqual(parsed.data, {
    args: ['server.js'],
    command: 'node',
    env: { API_KEY: 'secret' },
    saveScope: 'global',
    serverName: 'local-server',
    type: 'stdio',
  })
})

test('parseMcpAddServerInput rejects stdio entries without a command', () => {
  const parsed = parseMcpAddServerInput({
    serverName: 'local-server',
    type: 'stdio',
  })

  assert.equal(parsed.success, false)
  assert.match(parsed.error ?? '', new RegExp(MCP_VALIDATION_ERRORS.STDIO_FIELDS_ERROR))
})

test('parseMcpAddServerInput normalizes streamable-http server entries', () => {
  const parsed = parseMcpAddServerInput({
    headers: {
      Authorization: ' Bearer token ',
    },
    serverName: 'remote-server',
    type: 'streamable-http',
    url: ' https://example.com/mcp ',
  })

  assert.equal(parsed.success, true)
  assert.deepEqual(parsed.data, {
    headers: { Authorization: 'Bearer token' },
    saveScope: 'global',
    serverName: 'remote-server',
    type: 'streamable-http',
    url: 'https://example.com/mcp',
  })
})
