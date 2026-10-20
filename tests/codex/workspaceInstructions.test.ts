import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { buildWorkspaceInstructionsHiddenContext } from '../../src/lib/hiddenUserContext'
import {
  applyWorkspaceInstructionsContext,
  buildWorkspaceInstructionsRuntimeBlock,
} from '../../electron/chat/shared/prompts/workspaceInstructions'

function modelText(messages: readonly ModelMessage[]) {
  return messages.map((message) => typeof message.content === 'string'
    ? message.content
    : message.content.map((part) => 'text' in part ? part.text : '').join('\n')).join('\n')
}

test('stable workspace instruction contract keeps the conditional bootstrap guidance', () => {
  const block = buildWorkspaceInstructionsRuntimeBlock()

  assert.match(block, /revision-aware hidden bootstrap context/u)
  assert.match(block, /bootstrap does not contain the file contents/u)
  assert.match(block, /Read the current `AGENTS\.md` only when that exact revision has not already been read/u)
  assert.match(block, /reuse it and do not read it again/u)
  assert.doesNotMatch(block, /authoritative workspace instructions|optional reference data|before each action|Do not skip applicable requirements/u)
  assert.match(block, /bootstrap revision changes/u)
  assert.match(block, /continue without attempting that bootstrap read/u)
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
    assert.match(injectedText, /AGENTS\.md changed\. Read it again in full and treat it as authoritative workspace instructions/u)
    assert.match(injectedText, /Follow every applicable requirement and exception; do not treat it as optional reference data/u)
    assert.doesNotMatch(injectedText, /# Current rules|Use tests\./u)
    assert.doesNotMatch(injectedText, /old rules/u)
    assert.equal(injectedText.match(/kind="workspace_instructions"/gu)?.length, 1)
    assert.match(messages[0]?.content ?? '', /old rules/u)

    const unchanged = modelText(applyWorkspaceInstructionsContext(injected, workspaceRootPath))
    assert.doesNotMatch(unchanged, /AGENTS\.md changed/u)
    assert.match(unchanged, /Read AGENTS\.md in full and treat it as authoritative workspace instructions throughout this task/u)

    const fileStats = await fs.stat(path.join(workspaceRootPath, 'AGENTS.md'))
    const currentRevision = `${fileStats.mtimeMs}:${fileStats.size}`
    const transitionedMessages: ModelMessage[] = [
      {
        role: 'user',
        content: buildWorkspaceInstructionsHiddenContext('old-revision').content,
      },
      {
        role: 'user',
        content: [
          'Implement this.',
          buildWorkspaceInstructionsHiddenContext(currentRevision).content,
        ].join('\n\n'),
      },
    ]
    const transitioned = modelText(applyWorkspaceInstructionsContext(transitionedMessages, workspaceRootPath))
    assert.match(transitioned, /AGENTS\.md changed\. Read it again in full and treat it as authoritative workspace instructions/u)
    assert.doesNotMatch(transitionedMessages[1]?.content ?? '', /AGENTS\.md changed/u)

    await fs.rm(path.join(workspaceRootPath, 'AGENTS.md'))
    const removed = modelText(applyWorkspaceInstructionsContext(injected, workspaceRootPath))
    assert.match(removed, /Implement this\./u)
    assert.doesNotMatch(removed, /workspace_instructions|Current rules/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('strong workspace instruction guidance is absent without a root AGENTS.md file', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-no-agents-'))
  const messages: ModelMessage[] = [{
    role: 'user',
    content: 'Inspect the project.\n\n' + buildWorkspaceInstructionsHiddenContext('old-revision').content,
  }]

  try {
    for (const root of [null, workspaceRootPath]) {
      const projected = modelText(applyWorkspaceInstructionsContext(messages, root))
      assert.equal(projected, 'Inspect the project.')
    }

    await fs.mkdir(path.join(workspaceRootPath, 'AGENTS.md'))
    const projected = modelText(applyWorkspaceInstructionsContext(messages, workspaceRootPath))
    assert.equal(projected, 'Inspect the project.')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
