import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTerminalReasoningEffortItems } from '../../electron/cli/terminalReasoningEffort'
import type { SystemModelItem } from '../../electron/cli/models'

function createModel(overrides: Partial<SystemModelItem> = {}): SystemModelItem {
  return {
    apiModelId: 'gpt-test',
    id: 'openai:gpt-test',
    isConfigured: true,
    isCustom: false,
    label: 'GPT Test',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    reasoningCapable: true,
    reasoningEfforts: ['low', 'medium', 'high'],
    ...overrides,
  }
}

test('CLI model reasoning items match desktop ordering, labels, and current selection', () => {
  const items = buildTerminalReasoningEffortItems(createModel(), 'medium')

  assert.deepEqual(items.map((item) => item.value), ['high', 'medium', 'low'])
  assert.deepEqual(items.map((item) => item.label), ['High', 'Medium', 'Low'])
  assert.equal(items.find((item) => item.isCurrent)?.value, 'medium')
})

test('CLI model reasoning stays unavailable for models without declared reasoning controls', () => {
  assert.deepEqual(buildTerminalReasoningEffortItems(createModel({ reasoningCapable: false }), 'medium'), [])
})
