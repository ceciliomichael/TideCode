import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { injectedPromptTemplates } from '../../src/lib/generatedInjectedPrompts'
import { renderInjectedPrompt } from '../../src/lib/injectedPrompts'
import {
  buildChatModeHiddenContext,
  buildExecutionModeHiddenContext,
  buildRuntimeEnvironmentHiddenContextTransitions,
  buildWorkspaceMemoryHiddenContext,
} from '../../src/lib/hiddenUserContext'

const promptFolder = path.resolve(
  import.meta.dirname,
  '../../electron/chat/shared/ai/prompts/injected',
)

test('embedded user-context templates match their editable Markdown source files', async () => {
  for (const [name, template] of Object.entries(injectedPromptTemplates)) {
    const markdown = (await readFile(path.join(promptFolder, name + '.md'), 'utf8')).trim()
    assert.equal(template, markdown, name)
    assert.ok(!template.includes('<hidden_user_context'), name)
  }
})

test('runtime injects the selected Markdown for each chat and access mode', () => {
  assert.ok(buildChatModeHiddenContext('plan').content.includes(renderInjectedPrompt('planMode')))
  assert.ok(buildChatModeHiddenContext('agent').content.includes(renderInjectedPrompt('agentMode')))
  assert.ok(buildExecutionModeHiddenContext('sandbox').content.includes(renderInjectedPrompt('executionSandbox')))
  assert.ok(buildExecutionModeHiddenContext('full').content.includes(renderInjectedPrompt('executionFullAccess')))
})

test('runtime interpolates escaped facts, keeping revision/state envelopes dynamic', () => {
  const shell = buildRuntimeEnvironmentHiddenContextTransitions({
    environment: {
      terminalShell: { label: '<danger>', command: 'pwsh & sh' },
      pythonVenv: { name: 'venv', relativePath: '.venv' },
    },
    messages: [],
  })
  assert.deepEqual(shell.map(context => context.kind), ['terminal_shell', 'python_venv'])
  assert.match(shell[0].content, /&lt;danger&gt;/u)
  assert.match(shell[0].content, /pwsh &amp; sh/u)
  assert.match(shell[1].content, /Python virtual environment activated: venv/u)

  const memory = buildWorkspaceMemoryHiddenContext()
  assert.equal(memory.state, 'enabled')
  assert.ok(memory.content.includes(renderInjectedPrompt('workspaceMemoryEnabled')))
  assert.ok(!memory.content.includes('Current MEMORY.md index:'))

})

test('template variables must match provided runtime values', () => {
  assert.throws(() => renderInjectedPrompt('terminalEnvironment'), /Missing SHELL_LABEL/u)
  assert.throws(() => renderInjectedPrompt('agentMode', { SECRET: 'ignored' }), /Unexpected SECRET/u)
})
