import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  activateVenvInEnvironment,
  buildPythonVenvPromptBlock,
  detectVenvInfo,
  findVenvPath,
  hasPyvenvCfg,
} from '../../electron/python/venv'

test('hasPyvenvCfg returns true only if pyvenv.cfg exists', async () => {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-venv-test-'))
  try {
    assert.equal(hasPyvenvCfg(tmpDir), false)
    await fs.writeFile(path.join(tmpDir, 'pyvenv.cfg'), 'home = /usr/bin/python\n', 'utf8')
    assert.equal(hasPyvenvCfg(tmpDir), true)
  } finally {
    await fs.rm(tmpDir, { force: true, recursive: true })
  }
})

test('findVenvPath detects venv in workspace root and subdirectories', async () => {
  const workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-venv-ws-'))
  const venvDir = path.join(workspaceDir, '.venv')
  await fs.mkdir(venvDir, { recursive: true })
  await fs.writeFile(path.join(venvDir, 'pyvenv.cfg'), 'home = /usr/bin/python\n', 'utf8')

  try {
    const foundPath = findVenvPath(workspaceDir, workspaceDir)
    assert.equal(foundPath, venvDir)
  } finally {
    await fs.rm(workspaceDir, { force: true, recursive: true })
  }
})

test('detectVenvInfo returns name, relativePath, and venvPath', async () => {
  const workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-venv-info-ws-'))
  const venvDir = path.join(workspaceDir, 'myenv')
  await fs.mkdir(venvDir, { recursive: true })
  await fs.writeFile(path.join(venvDir, 'pyvenv.cfg'), 'home = /usr/bin/python\n', 'utf8')

  try {
    const info = detectVenvInfo(workspaceDir)
    assert.ok(info)
    assert.equal(info.name, 'myenv')
    assert.equal(info.relativePath, 'myenv')
    assert.equal(info.venvPath, venvDir)
  } finally {
    await fs.rm(workspaceDir, { force: true, recursive: true })
  }
})

test('buildPythonVenvPromptBlock formats short prompt block with venv name', async () => {
  const workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-venv-prompt-ws-'))
  const venvDir = path.join(workspaceDir, '.venv')
  await fs.mkdir(venvDir, { recursive: true })
  await fs.writeFile(path.join(venvDir, 'pyvenv.cfg'), 'home = /usr/bin/python\n', 'utf8')

  try {
    const promptBlock = buildPythonVenvPromptBlock(workspaceDir)
    assert.equal(promptBlock, 'Python virtual environment activated: .venv')
  } finally {
    await fs.rm(workspaceDir, { force: true, recursive: true })
  }
})

test('activateVenvInEnvironment sets VIRTUAL_ENV and prepends PATH', () => {
  const initialEnv = { PATH: '/usr/bin:/bin' }
  const venvPath = path.resolve('/path/to/venv')
  const updatedEnv = activateVenvInEnvironment(initialEnv, venvPath)

  assert.equal(updatedEnv.VIRTUAL_ENV, venvPath)
  const isWindows = process.platform === 'win32'
  const expectedBin = isWindows ? path.join(venvPath, 'Scripts') : path.join(venvPath, 'bin')
  assert.ok(updatedEnv.PATH?.startsWith(expectedBin))
})

test('detectVenvInfo handles custom venv names like asjdajsd', async () => {
  const workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-venv-custom-ws-'))
  const venvDir = path.join(workspaceDir, 'asjdajsd')
  await fs.mkdir(venvDir, { recursive: true })
  await fs.writeFile(path.join(venvDir, 'pyvenv.cfg'), 'home = /usr/bin/python\n', 'utf8')

  try {
    const info = detectVenvInfo(workspaceDir)
    assert.ok(info)
    assert.equal(info.name, 'asjdajsd')

    const promptBlock = buildPythonVenvPromptBlock(workspaceDir)
    assert.equal(promptBlock, 'Python virtual environment activated: asjdajsd')
  } finally {
    await fs.rm(workspaceDir, { force: true, recursive: true })
  }
})
