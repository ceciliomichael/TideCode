import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  computeRunServiceBuildId,
  computeSourceRunServiceBuildId,
  resolveRunServiceBuildIdFromEnvironment,
  RUN_SERVICE_BUILD_ID_ENV,
} from '../electron/runService/buildIdentity'

test('run-service bundle identity changes when the built service changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tidecode-run-service-build-'))
  const entry = path.join(root, 'run-service.mjs')

  try {
    await writeFile(entry, 'export const version = 1\n')
    const first = computeRunServiceBuildId(entry)
    assert.match(first, /^[a-f0-9]{64}$/u)

    await writeFile(entry, 'export const version = 2\n')
    const second = computeRunServiceBuildId(entry)
    assert.notEqual(second, first)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('source run-service identity includes runtime dependencies, not only the entry file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tidecode-run-service-source-'))

  try {
    await mkdir(path.join(root, 'electron', 'runService'), { recursive: true })
    await mkdir(path.join(root, 'electron', 'chat'), { recursive: true })
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'electron', 'runService', 'index.ts'), 'export {}\n')
    await writeFile(path.join(root, 'electron', 'chat', 'runtime.ts'), 'export const vision = false\n')
    await writeFile(path.join(root, 'src', 'types.ts'), 'export type Example = string\n')
    await writeFile(path.join(root, 'package.json'), '{}\n')

    const first = computeSourceRunServiceBuildId(root)
    await writeFile(path.join(root, 'electron', 'chat', 'runtime.ts'), 'export const vision = true\n')
    const second = computeSourceRunServiceBuildId(root)

    assert.notEqual(second, first)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('run-service build identity environment rejects missing and malformed values', () => {
  assert.throws(() => resolveRunServiceBuildIdFromEnvironment({}), /missing or invalid/u)
  assert.throws(
    () => resolveRunServiceBuildIdFromEnvironment({ [RUN_SERVICE_BUILD_ID_ENV]: 'not-a-hash' }),
    /missing or invalid/u,
  )

  const buildId = 'a'.repeat(64)
  assert.equal(
    resolveRunServiceBuildIdFromEnvironment({ [RUN_SERVICE_BUILD_ID_ENV]: buildId.toUpperCase() }),
    buildId,
  )
})
