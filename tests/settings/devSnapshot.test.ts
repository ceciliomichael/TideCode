import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  isDevSettingsSnapshotFile,
  synchronizeDevSettingsSnapshot,
} from '../../electron/settings/devSnapshot'

test('development settings snapshots include only application settings files', async () => {
  const tempRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-dev-settings-'),
  )
  const productionHomePath = path.join(tempRootPath, 'production-home')
  const developmentHomePath = path.join(tempRootPath, 'development-home')
  const productionConfigPath = path.join(
    productionHomePath,
    '.tidecode',
    'config',
  )
  const developmentConfigPath = path.join(
    developmentHomePath,
    '.tidecode',
    'config',
  )

  try {
    await fs.mkdir(productionConfigPath, { recursive: true })
    await fs.mkdir(developmentConfigPath, { recursive: true })
    await fs.writeFile(
      path.join(productionConfigPath, 'settings.json'),
      '{"shared":true}',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'surface-settings.desktop.json'),
      '{"surface":"desktop"}',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'surface-settings.web.json'),
      '{"surface":"web"}',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'surface-settings.cli.json'),
      '{"surface":"cli"}',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'workspace-ui-state.json'),
      '{"legacy":true}',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'providers.json'),
      '{"secret":"do-not-copy"}',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'settings.lock'),
      '1234\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(productionConfigPath, 'settings.json.tmp-1234'),
      'stale',
      'utf8',
    )
    await fs.writeFile(
      path.join(developmentConfigPath, 'surface-settings.cli.json'),
      'old',
      'utf8',
    )

    await synchronizeDevSettingsSnapshot(
      productionHomePath,
      developmentHomePath,
    )

    assert.equal(
      await fs.readFile(
        path.join(developmentConfigPath, 'settings.json'),
        'utf8',
      ),
      '{"shared":true}',
    )
    assert.equal(
      await fs.readFile(
        path.join(developmentConfigPath, 'surface-settings.desktop.json'),
        'utf8',
      ),
      '{"surface":"desktop"}',
    )
    assert.equal(
      await fs.readFile(
        path.join(developmentConfigPath, 'surface-settings.web.json'),
        'utf8',
      ),
      '{"surface":"web"}',
    )
    assert.equal(
      await fs.readFile(
        path.join(developmentConfigPath, 'surface-settings.cli.json'),
        'utf8',
      ),
      '{"surface":"cli"}',
    )
    assert.equal(
      await fs.readFile(
        path.join(developmentConfigPath, 'workspace-ui-state.json'),
        'utf8',
      ),
      '{"legacy":true}',
    )
    await assert.rejects(
      fs.access(path.join(developmentConfigPath, 'providers.json')),
      { code: 'ENOENT' },
    )
    await assert.rejects(
      fs.access(path.join(developmentConfigPath, 'settings.lock')),
      { code: 'ENOENT' },
    )
    await assert.rejects(
      fs.access(path.join(developmentConfigPath, 'settings.json.tmp-1234')),
      { code: 'ENOENT' },
    )
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('development settings snapshot file selection excludes locks, secrets, and temporary files', () => {
  assert.equal(isDevSettingsSnapshotFile('settings.json'), true)
  assert.equal(isDevSettingsSnapshotFile('surface-settings.desktop.json'), true)
  assert.equal(isDevSettingsSnapshotFile('surface-settings.web.json'), true)
  assert.equal(isDevSettingsSnapshotFile('surface-settings.cli.json'), true)
  assert.equal(isDevSettingsSnapshotFile('workspace-ui-state.json'), true)
  assert.equal(isDevSettingsSnapshotFile('providers.json'), false)
  assert.equal(isDevSettingsSnapshotFile('settings.lock'), false)
  assert.equal(isDevSettingsSnapshotFile('settings.json.tmp-1234'), false)
})
