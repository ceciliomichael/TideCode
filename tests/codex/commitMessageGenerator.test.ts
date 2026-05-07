import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCommitMessagePrompt,
  buildHeuristicCommitMessageFromDiff,
} from '../../electron/git/commitMessageGenerator'
import {
  normalizeGeneratedCommitMessage,
  normalizeGeneratedCommitMessageWithDescription,
} from '../../electron/git/commitMessageFormatting'

test('normalizeCommitMessageForTests keeps valid conventional commit subjects intact', () => {
  const normalized = normalizeGeneratedCommitMessage('fix(parser): handle empty commit message generation')
  assert.equal(normalized, 'fix(parser): handle empty commit message generation')
})

test('normalizeCommitMessageForTests strips formatting wrappers and adds fallback prefix', () => {
  const normalized = normalizeGeneratedCommitMessage('"Update commit generation flow"')
  assert.equal(normalized, 'chore: Update commit generation flow')
})

test('normalizeCommitMessageForTests enforces a concise one-line subject', () => {
  const normalized = normalizeGeneratedCommitMessage(
    'feat(editor): implement a very long commit message summary that keeps going past normal subject length limits',
  )

  assert.equal(normalized.length <= 72, true)
  assert.equal(normalized.startsWith('feat(editor):'), true)
  assert.equal(normalized.includes('\n'), false)
})

test('normalizeGeneratedCommitMessageWithDescription always returns subject plus a body description', () => {
  const normalized = normalizeGeneratedCommitMessageWithDescription(
    'fix(sync): keep branch checkout up to date',
    ['electron/git/service.ts'],
  )

  assert.equal(normalized.startsWith('fix(sync): keep branch checkout up to date'), true)
  assert.equal(normalized.includes('\n\n- '), true)
})

test('normalizeGeneratedCommitMessageWithDescription removes merge request wording from the body', () => {
  const normalized = normalizeGeneratedCommitMessageWithDescription(
    [
      'feat(commit): enrich generated commit descriptions',
      '',
      'What:',
      '- Add detail so this is ready for merge request creation',
      '',
      'Why:',
      '- Improves commit quality',
    ].join('\n'),
    ['electron/git/commitMessageGenerator.ts'],
  )

  assert.equal(/merge request/iu.test(normalized), false)
  assert.equal(normalized.includes('\n\n- '), true)
})

test('normalizeGeneratedCommitMessageWithDescription strips think blocks from generated content', () => {
  const normalized = normalizeGeneratedCommitMessageWithDescription(
    [
      '<think>plan the response</think>',
      'fix(commit): avoid leaking reasoning output into commits',
      '',
      '<think>ignore this</think>',
      '- Keep commit bodies free of model reasoning tags',
      '- Preserve visible commit text',
    ].join('\n'),
    ['electron/git/commitMessageFormatting.ts'],
  )

  assert.equal(normalized.startsWith('fix(commit): avoid leaking reasoning output into commits'), true)
  assert.equal(normalized.includes('<think>'), false)
  assert.equal(normalized.includes('plan the response'), false)
  assert.equal(normalized.includes('ignore this'), false)
  assert.equal(normalized.includes('Keep commit bodies free of model reasoning tags'), true)
})

test('buildCommitMessagePrompt explicitly bans generic filler and requires bullet output', () => {
  const prompt = buildCommitMessagePrompt({
    diffText: [
      'diff --git a/electron/git/commitMessageGenerator.ts b/electron/git/commitMessageGenerator.ts',
      '@@ -1,3 +1,5 @@',
      '-Generate the best possible commit message for this staged diff.',
      '+Write a git commit message for this staged diff.',
      '+- Do not use generic filler like "update implementation details" or "changed modules".',
    ].join('\n'),
    numstatText: '2\t1\telectron/git/commitMessageGenerator.ts',
  })

  assert.equal(prompt.promptText.includes('conventional commit subject no longer than 72 characters'), true)
  assert.equal(prompt.promptText.includes('Then write 2-4 bullet points'), true)
  assert.equal(prompt.promptText.includes('Do not use generic filler like "update implementation details"'), true)
})

test('buildCommitMessagePrompt compresses long numstat output into a short prompt summary', () => {
  const prompt = buildCommitMessagePrompt({
    diffText: [
      'diff --git a/electron/git/commitMessageGenerator.ts b/electron/git/commitMessageGenerator.ts',
      '@@ -1,3 +1,4 @@',
      '-const oldValue = 1',
      '+const newValue = 2',
    ].join('\n'),
    numstatText: Array.from({ length: 20 }, (_, index) => `${index + 1}\t0\tsrc/file-${index + 1}.ts`).join('\n'),
  })

  assert.equal(prompt.promptText.includes('Staged numstat (top changes only):'), true)
  assert.equal(prompt.promptText.includes('more files omitted'), true)
})

test('buildHeuristicCommitMessageFromDiff derives a specific fallback from diff context', () => {
  const commitMessage = buildHeuristicCommitMessageFromDiff({
    diffText: [
      'diff --git a/electron/chat/shared/tools/factory.ts b/electron/chat/shared/tools/factory.ts',
      '@@ -1,5 +1,6 @@',
      "-import { createToolRegistry } from './index'",
      "+import { createRipgrepTool } from './ripgrep'",
      "+import { createToolRegistry } from './index'",
      ' export function createSharedTools() {',
      '-  return createToolRegistry()',
      '+  return createToolRegistry([createRipgrepTool()])',
      ' }',
      'diff --git a/electron/chat/shared/tools/index.ts b/electron/chat/shared/tools/index.ts',
      '@@ -1,2 +1,3 @@',
      "+export { createRipgrepTool } from './ripgrep'",
      ' export { createToolRegistry } from "./factory"',
      'diff --git a/tests/codex/ripgrepTools.test.ts b/tests/codex/ripgrepTools.test.ts',
      '@@ -1,2 +1,5 @@',
      "+test('registers the ripgrep tool in shared factories', () => {",
      '+  assert.equal(true, true)',
      '+})',
    ].join('\n'),
    numstatText: [
      '3\t1\telectron/chat/shared/tools/factory.ts',
      '1\t0\telectron/chat/shared/tools/index.ts',
      '3\t0\ttests/codex/ripgrepTools.test.ts',
    ].join('\n'),
  })

  assert.equal(commitMessage.includes('update implementation details across changed modules'), false)
  assert.equal(commitMessage.includes('changed modules'), false)
  assert.equal(/\bripgrep\b/iu.test(commitMessage), true)
  assert.equal(commitMessage.includes('\n\n- '), true)
})
