import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCliSettingsPatch } from '../../electron/cli/cliSettingsCommand'
import { buildCliDefaultModelSettingsPatch } from '../../electron/cli/cliDefaultModelSettings'
import { buildDisabledSkillsByPath } from '../../electron/cli/cliSkillsCommand'
import { buildCliMcpConfigUpdate } from '../../electron/cli/cliMcpCommand'
import type { McpServerConfig } from '../../src/types/mcp'

test('CLI follow-up setting builds a CLI-local preference patch', () => {
  assert.deepEqual(buildCliSettingsPatch('follow-up', 'steer'), { followUpBehavior: 'steer' })
  assert.deepEqual(buildCliSettingsPatch('follow-up', 'queue'), { followUpBehavior: 'queue' })
})

test('CLI default model selectors build CLI-local model patches while summarization stays shared', () => {
  assert.deepEqual(
    buildCliDefaultModelSettingsPatch('agent-model', {
      kind: 'model',
      label: 'GPT 5.6',
      modelId: 'gpt-5.6',
      providerId: 'codex',
    }),
    {
      agentModelId: 'gpt-5.6',
      agentModelLabel: 'GPT 5.6',
      agentModelProviderId: 'codex',
    },
  )
  assert.deepEqual(buildCliDefaultModelSettingsPatch('plan-model', { kind: 'inherit' }), {
    planModelId: '',
    planModelLabel: '',
    planModelProviderId: null,
  })
  assert.deepEqual(
    buildCliDefaultModelSettingsPatch('summarization-model', {
      kind: 'model',
      label: 'Claude',
      modelId: 'claude-test',
      providerId: 'anthropic',
    }),
    {
      summarizationModelId: 'claude-test',
      summarizationModelLabel: 'Claude',
      summarizationModelProviderId: 'anthropic',
    },
  )
})

test('skills save only discovered disabled paths while preserving unrelated preferences', () => {
  const result = buildDisabledSkillsByPath(
    { legacy: true, first: true },
    ['first', 'second'],
    new Set(['first']),
  )
  assert.deepEqual(result, { legacy: true, second: true })
})

test('MCP save toggles the server and known tools while preserving unknown overrides', () => {
  const config: McpServerConfig = {
    autoConnect: true,
    enabled: true,
    id: 'server-1',
    isReadOnly: false,
    name: 'Files',
    owner: 'tidecode',
    source: 'global',
    toolNamespace: 'files',
    type: 'stdio',
    command: 'server',
    toolConfiguration: { enabled: true, disabledTools: ['legacy_tool'] },
  }
  const result = buildCliMcpConfigUpdate(config, ['read', 'write'], new Set(['read']))

  assert.equal(result.enabled, false)
  assert.deepEqual(result.toolConfiguration?.disabledTools, ['legacy_tool', 'write'])
})
