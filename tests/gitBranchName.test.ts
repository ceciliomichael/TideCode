import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGitBranchName, sanitizeGitBranchInput } from '../src/lib/gitBranchName'

test('sanitizeGitBranchInput keeps spaces editable while removing unsupported characters', () => {
  assert.equal(sanitizeGitBranchInput('feature branch/$name?'), 'feature branch/name')
})

test('normalizeGitBranchName converts whitespace to dashes at commit time', () => {
  assert.equal(normalizeGitBranchName('  feature  branch / fix  '), 'feature-branch-/-fix')
})
