import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../src/lib/defaultAppSettings'
import {
  buildSurfaceModelSelectionSettingsPatch,
  resolveSurfaceModeModelSelection,
} from '../src/lib/surfaceModelSettings'

test('surface startup prefers the configured agent model over stale chatModelId', () => {
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    chatModelId: 'gpt-5.5',
    chatModelLabel: 'gpt-5.5',
    chatModelProviderId: 'codex' as const,
    agentModelId: 'gpt-5.6-luna',
    agentModelLabel: 'gpt-5.6-luna',
    agentModelProviderId: 'codex' as const,
  }

  const selection = resolveSurfaceModeModelSelection('agent', settings)
  assert.equal(selection.modelId, 'gpt-5.6-luna')
  assert.equal(selection.modelLabel, 'gpt-5.6-luna')
  assert.equal(selection.providerId, 'codex')
})

test('surface startup prefers the configured plan model over stale chatModelId', () => {
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    chatModelId: 'gpt-5.5',
    chatModelProviderId: 'codex' as const,
    planModelId: 'gpt-5.6-luna',
    planModelLabel: 'gpt-5.6-luna',
    planModelProviderId: 'codex' as const,
  }

  assert.equal(resolveSurfaceModeModelSelection('plan', settings).modelId, 'gpt-5.6-luna')
})

test('selector changes persist the active mode default and compatibility chat selection together', () => {
  assert.deepEqual(buildSurfaceModelSelectionSettingsPatch('agent', {
    modelId: 'gpt-5.6-luna',
    modelLabel: 'GPT 5.6 Luna',
    providerId: 'codex',
    reasoningEffort: 'high',
  }), {
    agentModelId: 'gpt-5.6-luna',
    agentModelLabel: 'GPT 5.6 Luna',
    agentModelProviderId: 'codex',
    chatModelId: 'gpt-5.6-luna',
    chatModelLabel: 'GPT 5.6 Luna',
    chatModelProviderId: 'codex',
    chatReasoningEffort: 'high',
  })
})
