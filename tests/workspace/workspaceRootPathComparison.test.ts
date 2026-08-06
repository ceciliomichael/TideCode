import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeWorkspaceRootPathForComparison } from '../../src/lib/workspaceRootPathComparison'

test('normalizeWorkspaceRootPathForComparison normalizes Windows drive paths case-insensitively', () => {
  assert.equal(
    normalizeWorkspaceRootPathForComparison('C:\\Users\\Admin\\Desktop\\tidecode'),
    normalizeWorkspaceRootPathForComparison('c:/users/admin/desktop/tidecode'),
  )
  assert.equal(
    normalizeWorkspaceRootPathForComparison('C:/Users/Admin/Desktop/tidecode'),
    normalizeWorkspaceRootPathForComparison('c:\\users\\admin\\desktop\\tidecode'),
  )
})

test('normalizeWorkspaceRootPathForComparison trims whitespace and trailing separators', () => {
  assert.equal(
    normalizeWorkspaceRootPathForComparison('  C:\\Users\\Admin\\Desktop\\tidecode\\  '),
    normalizeWorkspaceRootPathForComparison('C:/Users/Admin/Desktop/tidecode'),
  )
})

test('normalizeWorkspaceRootPathForComparison keeps non-Windows paths case-sensitive', () => {
  assert.equal(
    normalizeWorkspaceRootPathForComparison('/home/admin/project'),
    '/home/admin/project',
  )
  assert.notEqual(
    normalizeWorkspaceRootPathForComparison('/home/admin/Project'),
    normalizeWorkspaceRootPathForComparison('/home/admin/project'),
  )
})
