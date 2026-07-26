import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildWorkspaceInstructionsBlock } from '../../electron/chat/shared/prompts/workspaceInstructions'

test('workspace instruction cache refreshes after the file changes', async () => {
  const workspacePath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-instructions-'))
  const instructionsPath = path.join(workspacePath, 'AGENTS.md')

  try {
    await fs.writeFile(instructionsPath, 'First instruction', 'utf8')
    assert.match(buildWorkspaceInstructionsBlock(workspacePath) ?? '', /First instruction/u)

    await fs.writeFile(instructionsPath, 'Updated instruction with a different size', 'utf8')
    const updatedBlock = buildWorkspaceInstructionsBlock(workspacePath) ?? ''
    assert.match(updatedBlock, /Updated instruction with a different size/u)
    assert.doesNotMatch(updatedBlock, /First instruction/u)
  } finally {
    await fs.rm(workspacePath, { force: true, recursive: true })
  }
})
