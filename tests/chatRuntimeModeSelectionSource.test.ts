import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('chat runtime keeps per-mode local selections when toggling agent and plan', async () => {
  const source = await fs.readFile(
    new URL('../src/hooks/useChatRuntimeConfig.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /byMode: Partial<Record<ChatMode, SelectionOverride>>/u)
  assert.match(source, /selectionOverrides\.byMode\[activeChatMode\]/u)
  assert.match(source, /\[activeConversationId\]\)/u)
  assert.doesNotMatch(source, /setSelectionOverride\(null\)/u)
  assert.doesNotMatch(source, /updateSettings\(\{ chatReasoningEffort \}\)/u)
})
