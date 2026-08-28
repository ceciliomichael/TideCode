import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CONTEXT_COMPACTION_SETTINGS } from '../src/lib/contextCompactionSettings'
import { buildModeRuntimeSelection } from '../src/pages/chatInterface/chatInterfaceRuntime'

test('Plan to Agent handoff replaces the Plan model with the Agent default', () => {
  const result = buildModeRuntimeSelection({
    contextCompaction: DEFAULT_CONTEXT_COMPACTION_SETTINGS,
    hasConfiguredProvider: true,
    modelId: 'plan-model',
    providerId: 'anthropic',
    providerLabel: 'Anthropic',
    reasoningEffort: 'high',
    terminalExecutionMode: 'sandbox',
  }, {
    hasConfiguredProvider: true,
    modelId: 'agent-model',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    reasoningEffort: 'medium',
  })

  assert.equal(result.modelId, 'agent-model')
  assert.equal(result.providerId, 'openai')
  assert.equal(result.reasoningEffort, 'medium')
  assert.equal(result.terminalExecutionMode, 'sandbox')
  assert.equal(result.contextCompaction, DEFAULT_CONTEXT_COMPACTION_SETTINGS)
})
