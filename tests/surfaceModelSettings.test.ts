import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_APP_SETTINGS } from '../src/lib/defaultAppSettings'
import {
  resolveConversationModelSelection,
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
    agentReasoningEffort: 'low' as const,
  }

  const selection = resolveSurfaceModeModelSelection('agent', settings)
  assert.equal(selection.modelId, 'gpt-5.6-luna')
  assert.equal(selection.modelLabel, 'gpt-5.6-luna')
  assert.equal(selection.providerId, 'codex')
  assert.equal(selection.reasoningEffort, 'low')
})

test('surface startup prefers the configured plan model over stale chatModelId', () => {
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    chatModelId: 'gpt-5.5',
    chatModelProviderId: 'codex' as const,
    planModelId: 'gpt-5.6-luna',
    planModelLabel: 'gpt-5.6-luna',
    planModelProviderId: 'codex' as const,
    planReasoningEffort: 'high' as const,
  }

  const selection = resolveSurfaceModeModelSelection('plan', settings)
  assert.equal(selection.modelId, 'gpt-5.6-luna')
  assert.equal(selection.reasoningEffort, 'high')
})

test('conversation model preference overrides the default only for the matching mode', () => {
  const defaultSelection = resolveSurfaceModeModelSelection('agent', {
    ...DEFAULT_APP_SETTINGS,
    agentModelId: 'agent-default',
    agentModelLabel: 'Agent Default',
    agentModelProviderId: 'openai',
  })

  assert.equal(resolveConversationModelSelection('agent', defaultSelection, {
    chatMode: 'agent',
    label: 'Conversation Model',
    modelId: 'conversation-model',
    providerId: 'codex',
  }, null).modelId, 'conversation-model')

  assert.equal(resolveConversationModelSelection('plan', {
    ...defaultSelection,
    modelId: 'plan-default',
  }, {
    chatMode: 'agent',
    label: 'Conversation Model',
    modelId: 'conversation-model',
    providerId: 'codex',
  }, null).modelId, 'plan-default')
})

test('conversation keeps independent model and reasoning selections for agent and plan', () => {
  const preference = {
    chatMode: 'plan' as const,
    label: 'Plan Three',
    modelId: 'plan-3',
    providerId: 'codex' as const,
    reasoningEffort: 'low' as const,
    modeSelections: {
      agent: {
        label: 'Agent Two',
        modelId: 'agent-2',
        providerId: 'openai' as const,
        reasoningEffort: 'high' as const,
      },
      plan: {
        label: 'Plan Three',
        modelId: 'plan-3',
        providerId: 'codex' as const,
        reasoningEffort: 'low' as const,
      },
    },
  }

  const agentSelection = resolveConversationModelSelection(
    'agent',
    resolveSurfaceModeModelSelection('agent', DEFAULT_APP_SETTINGS),
    preference,
    null,
  )
  const planSelection = resolveConversationModelSelection(
    'plan',
    resolveSurfaceModeModelSelection('plan', DEFAULT_APP_SETTINGS),
    preference,
    null,
  )

  assert.equal(agentSelection.modelId, 'agent-2')
  assert.equal(agentSelection.providerId, 'openai')
  assert.equal(agentSelection.reasoningEffort, 'high')
  assert.equal(planSelection.modelId, 'plan-3')
  assert.equal(planSelection.providerId, 'codex')
  assert.equal(planSelection.reasoningEffort, 'low')
})

test('latest user model restores an unsaved draft choice without changing the configured default', () => {
  const defaultSelection = resolveSurfaceModeModelSelection('agent', {
    ...DEFAULT_APP_SETTINGS,
    agentModelId: 'agent-default',
    agentModelLabel: 'Agent Default',
    agentModelProviderId: 'openai',
  })

  const resolved = resolveConversationModelSelection('agent', defaultSelection, null, {
    chatMode: 'agent',
    content: 'hello',
    id: 'message-1',
    modelId: 'draft-runtime-model',
    providerId: 'google',
    reasoningEffort: 'high',
    role: 'user',
    timestamp: 1,
  })

  assert.equal(resolved.modelId, 'draft-runtime-model')
  assert.equal(resolved.providerId, 'google')
  assert.equal(defaultSelection.modelId, 'agent-default')
})
