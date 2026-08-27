import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceInstructionsBootstrapBlock } from '../../electron/chat/shared/prompts/workspaceInstructions'

test('workspace instruction bootstrap requires reading and following AGENTS.md', () => {
  const block = buildWorkspaceInstructionsBootstrapBlock()

  assert.match(block, /you must read `AGENTS\.md`/u)
  assert.match(block, /`AGENTS\.md` contains repository instructions/u)
  assert.match(block, /Follow all applicable instructions in it for project work/u)
  assert.match(block, /higher-priority instructions/u)
  assert.doesNotMatch(block, /list, glob, grep|filename inference|discovery results/u)
  assert.doesNotMatch(block, /<content>/u)
})
