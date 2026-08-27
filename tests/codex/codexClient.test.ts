import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CODEX_TURN_STATE_HEADER,
  createCodexTurnStateFetch,
} from '../../electron/chat/codex/client'
import { buildCodexProviderOptions } from '../../electron/chat/codex/providerOptions'
import { resolveSystemPromptTransportProviderOptions } from '../../electron/chat/shared/providerPromptTransport'

test('buildCodexProviderOptions preserves the Codex backend-compatible responses settings', () => {
  const providerOptions = buildCodexProviderOptions({
    reasoningEffort: 'medium',
    system: 'You are a coding assistant.',
  })

  assert.equal(providerOptions.openai.instructions, 'You are a coding assistant.')
  assert.equal(providerOptions.openai.systemMessageMode, 'remove')
  assert.equal(providerOptions.openai.store, false)
})

test('Codex turn state is captured once and replayed unchanged within a client turn', async () => {
  const requestTurnStates: Array<string | null> = []
  let responseNumber = 0
  const fetchWithTurnState = createCodexTurnStateFetch(async (_input, init) => {
    requestTurnStates.push(new Headers(init?.headers).get(CODEX_TURN_STATE_HEADER))
    responseNumber += 1
    return new Response('', {
      headers: {
        [CODEX_TURN_STATE_HEADER]: responseNumber === 1 ? 'turn-state-a' : 'turn-state-b',
      },
      status: 200,
    })
  })

  await fetchWithTurnState('https://example.test/one')
  await fetchWithTurnState('https://example.test/two')
  await fetchWithTurnState('https://example.test/three')

  assert.deepEqual(requestTurnStates, [null, 'turn-state-a', 'turn-state-a'])

  const freshClientTurnRequests: Array<string | null> = []
  const freshFetch = createCodexTurnStateFetch(async (_input, init) => {
    freshClientTurnRequests.push(new Headers(init?.headers).get(CODEX_TURN_STATE_HEADER))
    return new Response('', { status: 200 })
  })
  await freshFetch('https://example.test/fresh')
  assert.deepEqual(freshClientTurnRequests, [null])
})

test('OpenAI and Codex use the same single-copy system prompt transport', () => {
  const system = '<system_contract>shared TideCode instructions</system_contract>'
  assert.deepEqual(
    resolveSystemPromptTransportProviderOptions('openai', system),
    resolveSystemPromptTransportProviderOptions('codex', system),
  )
  assert.deepEqual(resolveSystemPromptTransportProviderOptions('openai', system), {
    openai: {
      instructions: system,
      systemMessageMode: 'remove',
    },
  })

  for (const providerId of ['anthropic', 'google', 'mistral', 'deepseek', 'custom:test'] as const) {
    assert.equal(resolveSystemPromptTransportProviderOptions(providerId, system), undefined)
  }
})
