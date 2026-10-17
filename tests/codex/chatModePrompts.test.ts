import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildChatModeSystemPrompt, buildChatModeSystemPromptBreakdown } from '../../electron/chat/shared/prompts/mode'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { buildPromptContextManifest } from '../../electron/chat/cache/canonicalization'
import { buildChatModeHiddenContext } from '../../src/lib/hiddenUserContext'
import { buildExecDescription } from '../../electron/chat/shared/ai/exec/exec'

test('system prompt uses exec-only TideCode tool boundary and keeps workspace constraints', () => {
  const prompt = buildChatModeSystemPrompt('agent', 'C:/workspace')
  assert.match(prompt, /<decision_priority/u)
  assert.match(prompt, /<workspace_root authoritative="true"/u)
  assert.match(prompt, /only TideCode-owned provider-facing tool is `exec`/u)
  assert.match(prompt, /tools\.terminal\.execute/u)
  assert.doesNotMatch(prompt, /direct `apply_patch`|provider-facing `code_mode`/u)
  const breakdown = buildChatModeSystemPromptBreakdown('agent', 'C:/workspace')
  assert.equal(breakdown.systemPrompt, prompt)
  assert.ok(breakdown.components.some((component) => component.source.includes('/ai/prompts/chat/')))
})

test('Agent and Plan use the same stable system instructions and mode-specific contexts', () => {
  const agent = buildChatModeSystemPrompt('agent', 'C:/workspace')
  const plan = buildChatModeSystemPrompt('plan', 'C:/workspace')
  assert.equal(agent, plan)
  assert.match(buildChatModeHiddenContext('plan').content, /tools\.plan\.create/u)
  assert.match(buildChatModeHiddenContext('plan').content, /tools\.patch/u)
  assert.doesNotMatch(buildChatModeHiddenContext('plan').content, /tools\.plan_edit|tools\.plan_create/u)
})

test('Mode-authorized exec catalog does not advertise unavailable mutations', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-exec-prompts-'))
  try {
    const agent = await createAgentToolBundle({ workspaceRootPath: root }, { chatMode: 'agent' })
    const plan = await createAgentToolBundle({ workspaceRootPath: root }, { chatMode: 'plan' })
    assert.match(buildExecDescription(agent.registry), /tools\.terminal\.execute/u)
    assert.doesNotMatch(buildExecDescription(plan.registry), /tools\.terminal\.execute/u)
    assert.match(buildExecDescription(plan.registry), /tools\.plan\.create/u)
    assert.doesNotMatch(buildExecDescription(agent.registry), /tools\.plan\.create/u)
    assert.deepEqual(Object.keys(agent.tools), ['exec'])
    assert.deepEqual(Object.keys(plan.tools), ['exec'])
    await agent.codeModeExecutor.dispose()
    await plan.codeModeExecutor.dispose()
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})

test('Provider-native web search stays independent of TideCode exec', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-provider-prompts-'))
  try {
    const bundle = await createAgentToolBundle({ workspaceRootPath: root }, { chatMode: 'agent', providerId: 'openai' })
    assert.deepEqual(Object.keys(bundle.tools).sort(), ['exec', 'web_search'])
    const manifest = buildPromptContextManifest({
      modelId: 'test-model',
      providerId: 'openai',
      system: buildChatModeSystemPrompt('agent', root),
      tools: bundle.tools,
    })
    assert.ok(manifest.toolsHash.length > 0)
    await bundle.codeModeExecutor.dispose()
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
