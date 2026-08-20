import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPullRequestMessagePrompt,
  normalizeGeneratedPullRequestDetails,
} from '../../electron/git/pullRequestMessageGenerator'

test('normalizeGeneratedPullRequestDetails parses generated title and markdown body', () => {
  const details = normalizeGeneratedPullRequestDetails(
    [
      'TITLE: Improve repository publishing commits',
      'BODY:',
      '## Summary',
      '- Generate first commit messages from staged changes.',
      '- Preserve a deterministic fallback for empty repositories.',
    ].join('\n'),
    'chore: fallback commit\n\n- fallback body',
  )

  assert.equal(details.title, 'Improve repository publishing commits')
  assert.equal(details.body.includes('## Summary'), true)
  assert.equal(details.body.includes('Generate first commit messages from staged changes.'), true)
})

test('normalizeGeneratedPullRequestDetails removes thinking and markdown fence wrappers', () => {
  const details = normalizeGeneratedPullRequestDetails(
    [
      '<think>inspect the branch</think>',
      String.fromCharCode(96, 96, 96) + 'markdown',
      'TITLE: Generate pull request details from branch context',
      'BODY:',
      '## Summary',
      '- Summarize the full branch diff.',
      String.fromCharCode(96, 96, 96),
    ].join('\n'),
    'fix: fallback title\n\n- fallback body',
  )

  assert.equal(details.title, 'Generate pull request details from branch context')
  assert.equal(details.body.includes('<think>'), false)
  assert.equal(details.body.includes(String.fromCharCode(96, 96, 96)), false)
})

test('normalizeGeneratedPullRequestDetails falls back to commit text for empty model output', () => {
  const details = normalizeGeneratedPullRequestDetails(
    '',
    'fix(publish): derive initial commit text\n\n- Inspect staged changes before publishing.',
  )

  assert.equal(details.title, 'fix(publish): derive initial commit text')
  assert.equal(details.body, '- Inspect staged changes before publishing.')
})

test('buildPullRequestMessagePrompt describes the full branch rather than only the latest commit', () => {
  const prompt = buildPullRequestMessagePrompt({
    commitLogText: 'abc123 feat: add publish flow\ndef456 test: cover publish flow',
    diffText: [
      'diff --git a/electron/git/servicePublish.ts b/electron/git/servicePublish.ts',
      '@@ -1,2 +1,3 @@',
      '+generate staged commit message',
    ].join('\n'),
    numstatText: '1\t0\telectron/git/servicePublish.ts',
  })

  assert.equal(prompt.includes('complete branch diff'), true)
  assert.equal(prompt.includes('abc123 feat: add publish flow'), true)
  assert.equal(prompt.includes('Do not claim that tests were run'), true)
  assert.equal(prompt.includes('electron/git/servicePublish.ts'), true)
})
