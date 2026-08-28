import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import {
  applyWorkspaceInstructionsContext,
  buildWorkspaceInstructionsRuntimeBlock,
} from '../../electron/chat/shared/prompts/workspaceInstructions'

function modelText(messages: readonly ModelMessage[]) {
  return messages.map((message) => typeof message.content === 'string'
    ? message.content
    : message.content.map((part) => 'text' in part ? part.text : '').join('\n')).join('\n')
}

test('workspace instruction prompt reads AGENTS.md only when the current revision is not already in context', () => {
  const block = buildWorkspaceInstructionsRuntimeBlock()

  assert.match(block, /revision-aware hidden bootstrap context/u)
  assert.match(block, /bootstrap does not contain the file contents/u)
  assert.match(block, /Read the current `AGENTS\.md` only when that exact revision has not already been read/u)
  assert.match(block, /reuse it and do not read it again/u)
  assert.match(block, /bootstrap revision changes/u)
  assert.match(block, /continue without attempting that bootstrap read/u)
  assert.doesNotMatch(block, /you must read it/u)
})

test('workspace bootstrap replaces stale context without embedding file contents and is removed when unavailable', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-injected-agents-'))
  const messages: ModelMessage[] = [{
    role: 'user',
    content: 'Implement this.\n\n<hidden_user_context kind="workspace_instructions" state="old">\nold rules\n</hidden_user_context>',
  }]

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'AGENTS.md'), '# Current rules\n\nUse tests.\n', 'utf8')
    const injected = applyWorkspaceInstructionsContext(messages, workspaceRootPath)
    const injectedText = modelText(injected)

    assert.match(injectedText, /Implement this\./u)
    assert.match(injectedText, /A root AGENTS\.md exists/u)
    assert.doesNotMatch(injectedText, /# Current rules|Use tests\./u)
    assert.doesNotMatch(injectedText, /old rules/u)
    assert.equal(injectedText.match(/kind="workspace_instructions"/gu)?.length, 1)

    await fs.rm(path.join(workspaceRootPath, 'AGENTS.md'))
    const removed = modelText(applyWorkspaceInstructionsContext(injected, workspaceRootPath))
    assert.match(removed, /Implement this\./u)
    assert.doesNotMatch(removed, /workspace_instructions|Current rules/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
