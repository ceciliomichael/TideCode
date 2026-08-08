import assert from 'node:assert/strict'
import test from 'node:test'
import type { McpServerConfig } from '../../src/types/mcp'
import {
  assignMcpToolNamespaces,
  createLegacyMcpServerId,
  createMcpCatalogToolName,
  isValidMcpServerId,
} from '../../electron/mcp/mcpNaming'

function createConfig(id: string, name: string, toolNamespace: string): McpServerConfig {
  return {
    autoConnect: false,
    enabled: true,
    id,
    isReadOnly: false,
    name,
    owner: 'tidecode',
    source: 'global',
    toolNamespace,
    type: 'stdio',
  }
}

test('MCP catalog names stay readable and within the compact naming budget', () => {
  const catalogName = createMcpCatalogToolName('GitHub', 'search repositories')

  assert.equal(catalogName, 'mcp_github_search_repositories')
  assert.ok(catalogName.length <= 64)
  assert.match(catalogName, /^mcp_[a-z0-9_]+$/u)
})

test('MCP server namespaces get deterministic suffixes only when they collide', () => {
  const configs = [
    createConfig('mcp-github-a', 'GitHub', 'github'),
    createConfig('mcp-github-b', 'GitHub mirror', 'github'),
  ]

  const assigned = assignMcpToolNamespaces(configs)
  const repeated = assignMcpToolNamespaces(configs)

  assert.equal(assigned[0].toolNamespace, 'github')
  assert.match(assigned[1].toolNamespace, /^github_[a-f0-9]{6}$/u)
  assert.deepEqual(assigned, repeated)
})

test('legacy server IDs remain stable while distinguishing normalized name collisions', () => {
  const first = createLegacyMcpServerId('GitHub', 'tidecode')
  const second = createLegacyMcpServerId('github', 'tidecode')

  assert.notEqual(first, second)
  assert.ok(isValidMcpServerId(first))
  assert.ok(isValidMcpServerId(second))
})
