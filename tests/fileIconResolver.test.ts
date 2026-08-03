import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFileIconConfig } from '../src/lib/fileIconResolver'

test('resolveFileIconConfig maps SQL files to the database icon', () => {
  const iconConfig = resolveFileIconConfig({ fileName: 'schema.sql' })

  assert.equal(iconConfig.label, 'SQL')
  assert.equal(iconConfig.color, '#f55385')
  assert.equal(iconConfig.icon.name, 'FaDatabase')
})

test('resolveFileIconConfig maps environment files to the dotenv icon', () => {
  const environmentFileNames = ['.env', '.env.example', '.env.local', '.env.production']

  for (const fileName of environmentFileNames) {
    const iconConfig = resolveFileIconConfig({ fileName })

    assert.equal(iconConfig.label, 'Environment', `expected ${fileName} to resolve to the environment icon`)
    assert.equal(iconConfig.icon.name, 'SiDotenv', `expected ${fileName} to use the dotenv icon`)
  }
})

test('resolveFileIconConfig updates as a typed filename reaches a known extension', () => {
  const incompleteIconConfig = resolveFileIconConfig({ fileName: 'daily-update.' })
  const markdownIconConfig = resolveFileIconConfig({ fileName: 'daily-update.md' })

  assert.equal(incompleteIconConfig.label, 'File')
  assert.equal(markdownIconConfig.label, 'Markdown')
  assert.equal(markdownIconConfig.icon.name, 'SiMarkdown')
})
