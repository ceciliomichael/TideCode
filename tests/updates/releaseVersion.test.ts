import assert from 'node:assert/strict'
import test from 'node:test'
import { compareSemanticVersions, normalizeSemanticVersion, parseSemanticVersion } from '../../electron/updates/releaseVersion'

test('parses and normalizes release tags with an optional v prefix', () => {
  assert.deepEqual(parseSemanticVersion('v1.2.3'), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: [],
  })
  assert.equal(normalizeSemanticVersion('v1.2.3'), '1.2.3')
  assert.equal(normalizeSemanticVersion('1.2.3-beta.2'), '1.2.3-beta.2')
})

test('compares major, minor, and patch versions in release order', () => {
  assert.equal(compareSemanticVersions('1.0.1', '1.0.0') > 0, true)
  assert.equal(compareSemanticVersions('1.1.0', '1.0.9') > 0, true)
  assert.equal(compareSemanticVersions('2.0.0', '1.99.99') > 0, true)
  assert.equal(compareSemanticVersions('1.0.0', '1.0.0'), 0)
})

test('orders prerelease versions before their stable release', () => {
  assert.equal(compareSemanticVersions('1.0.0-beta.2', '1.0.0-beta.10') < 0, true)
  assert.equal(compareSemanticVersions('1.0.0-beta.10', '1.0.0') < 0, true)
  assert.equal(compareSemanticVersions('1.0.0', '1.0.0-beta.10') > 0, true)
})
