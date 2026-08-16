import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolveCliAppRoot } from '../electron/cli/appRoot'
import { buildChatModeSystemPrompt } from '../electron/chat/shared/prompts/mode'
import { buildChatCompressionSystemPrompt } from '../electron/chat/shared/prompts/compression'
import { configureTideCodeRuntimeRoot } from '../electron/runtime/runtimeRoot'
import { getPackagedRunServiceLaunch } from '../electron/runService/ensureService'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('CLI app root is deterministic for source and packaged entry layouts', () => {
  const sourceEntry = pathToFileURL(path.join(workspaceRoot, 'electron', 'cli', 'appRoot.ts')).href
  const packagedRoot = path.join(workspaceRoot, 'release-fixture', 'resources', 'cli')
  const packagedEntry = pathToFileURL(path.join(packagedRoot, 'index.mjs')).href

  assert.equal(resolveCliAppRoot(sourceEntry), workspaceRoot)
  assert.equal(resolveCliAppRoot(packagedEntry), packagedRoot)
})

test('chat prompt loading uses the configured runtime root and ignores app root and workspace cwd', { concurrency: false }, async () => {
  const temporaryWorkspace = await mkdtemp(path.join(os.tmpdir(), 'tidecode-prompt-cwd-'))
  const previousCwd = process.cwd()
  const previousAppRoot = process.env.APP_ROOT
  const previousRuntimeRoot = process.env.TIDECODE_RUNTIME_ROOT

  try {
    process.env.APP_ROOT = temporaryWorkspace
    configureTideCodeRuntimeRoot(workspaceRoot)
    process.chdir(temporaryWorkspace)

    assert.ok(buildChatModeSystemPrompt('agent', temporaryWorkspace).length > 0)
    assert.ok(buildChatCompressionSystemPrompt().length > 0)
  } finally {
    process.chdir(previousCwd)
    if (previousAppRoot === undefined) delete process.env.APP_ROOT
    else process.env.APP_ROOT = previousAppRoot
    if (previousRuntimeRoot === undefined) delete process.env.TIDECODE_RUNTIME_ROOT
    else process.env.TIDECODE_RUNTIME_ROOT = previousRuntimeRoot
    await rm(temporaryWorkspace, { force: true, recursive: true })
  }
})

test('packaged Desktop launches the shared service with the CLI runtime as its asset root', async () => {
  const resourcesRoot = await mkdtemp(path.join(os.tmpdir(), 'tidecode-packaged-resources-'))
  const cliRoot = path.join(resourcesRoot, 'cli')
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'

  try {
    await mkdir(cliRoot, { recursive: true })
    await Promise.all([
      writeFile(path.join(cliRoot, 'run-service.mjs'), ''),
      writeFile(path.join(cliRoot, nodeName), ''),
    ])

    const launch = getPackagedRunServiceLaunch(resourcesRoot)
    assert.ok(launch)
    assert.equal(launch.args[0], path.join(cliRoot, 'run-service.mjs'))
    assert.equal(launch.executable, path.join(cliRoot, nodeName))
    assert.equal(launch.env.TIDECODE_RUNTIME_ROOT, path.resolve(cliRoot))
  } finally {
    await rm(resourcesRoot, { force: true, recursive: true })
  }
})
