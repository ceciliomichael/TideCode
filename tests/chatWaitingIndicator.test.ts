import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAssistantWaitingIndicatorVariant } from '../src/components/chat/assistantWaitingIndicator'

test('resolveAssistantWaitingIndicatorVariant promotes write tools to splash when no assistant text is visible', () => {
  const variant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText: false,
    toolInvocations: [{ toolName: 'write' }],
    waitingIndicatorVariant: 'thinking',
  })

  assert.equal(variant, 'splash')
})

test('resolveAssistantWaitingIndicatorVariant promotes edit tools to splash when no assistant text is visible', () => {
  const variant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText: false,
    toolInvocations: [{ toolName: 'edit' }],
    waitingIndicatorVariant: 'thinking',
  })

  assert.equal(variant, 'splash')
})

test('resolveAssistantWaitingIndicatorVariant preserves the original variant for non-file-change tools', () => {
  const variant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText: false,
    toolInvocations: [{ toolName: 'read' }],
    waitingIndicatorVariant: 'thinking',
  })

  assert.equal(variant, 'thinking')
})

test('resolveAssistantWaitingIndicatorVariant does not promote splash when write tools are mixed with exploring tools', () => {
  const variant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText: false,
    toolInvocations: [{ toolName: 'write' }, { toolName: 'read' }],
    waitingIndicatorVariant: 'thinking',
  })

  assert.equal(variant, 'thinking')
})

test('resolveAssistantWaitingIndicatorVariant preserves rate limit retry state', () => {
  const variant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText: false,
    toolInvocations: [{ toolName: 'write' }],
    waitingIndicatorVariant: 'rate_limit_retry',
  })

  assert.equal(variant, 'rate_limit_retry')
})
