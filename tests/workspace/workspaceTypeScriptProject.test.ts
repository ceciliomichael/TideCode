import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  clearWorkspaceTypeScriptProjectCache,
  getWorkspaceTypeScriptProject,
  invalidateWorkspaceTypeScriptProjectCache,
} from '../../electron/workspace/typescriptProject'
import { extractWorkspaceTypeScriptModuleSpecifiers } from '../../electron/workspace/typescriptProjectGraph'

async function writeFixtureFile(rootPath: string, relativePath: string, content: string) {
  const targetPath = path.join(rootPath, ...relativePath.split('/'))
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
}

test('workspace TypeScript project snapshot indexes local source and only needed package declarations', async (t) => {
  const workspaceRootPath = await mkdtemp(path.join(os.tmpdir(), 'tidecode-ts-project-'))
  t.after(async () => {
    clearWorkspaceTypeScriptProjectCache()
    await rm(workspaceRootPath, { recursive: true, force: true })
  })

  await writeFixtureFile(
    workspaceRootPath,
    'tsconfig.base.json',
    `{
  // JSONC and trailing commas are intentional.
  "compilerOptions": { "target": "ES2022", "strict": true, },
}`,
  )
  await writeFixtureFile(workspaceRootPath, 'tsconfig.json', JSON.stringify({
    extends: './tsconfig.base.json',
    compilerOptions: {
      baseUrl: '.',
      jsx: 'react-jsx',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      paths: { '@/*': ['src/*'] },
      resolveJsonModule: true,
    },
  }))
  await writeFixtureFile(workspaceRootPath, 'src/App.tsx', [
    "import { localValue } from '@/local'",
    "import type { FixtureValue } from 'fixture-package'",
    "import settings from './settings.json'",
    'export const value: FixtureValue = { value: localValue + settings.offset }',
  ].join('\n'))
  await writeFixtureFile(workspaceRootPath, 'src/local.ts', 'export const localValue = 2\n')
await writeFixtureFile(workspaceRootPath, 'src/settings.json', '{"offset":3}\n')
  await writeFixtureFile(workspaceRootPath, 'node_modules/fixture-package/package.json', JSON.stringify({
    name: 'fixture-package',
    types: 'index.d.ts',
  }))
  await writeFixtureFile(workspaceRootPath, 'node_modules/fixture-package/index.d.ts', [
    "import type { DependencyValue } from 'fixture-dep'",
    'export interface FixtureValue { value: DependencyValue }',
  ].join('\n'))
  await writeFixtureFile(workspaceRootPath, 'node_modules/fixture-dep/index.d.ts', 'export type DependencyValue = number\n')

  const sourceSnapshot = await getWorkspaceTypeScriptProject({
    includeDependencyDeclarations: false,
    relativePath: 'src/App.tsx',
    workspaceRootPath,
  })
  const sourcePaths = new Set(sourceSnapshot.files.map((file) => file.filePath.replace(/\\\\/gu, '/')))
  assert.ok(sourcePaths.has('src/App.tsx'))
  assert.ok(sourcePaths.has('src/local.ts'))
  assert.ok(sourcePaths.has('src/settings.json'))
  assert.equal([...sourcePaths].some((filePath) => filePath.startsWith('node_modules/')), false)

  const snapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'src/App.tsx',
    workspaceRootPath,
  })
  const indexedPaths = new Set(snapshot.files.map((file) => file.filePath.replace(/\\\\/gu, '/')))

  assert.equal(snapshot.configPath, 'tsconfig.json')
  assert.equal(snapshot.projectKey, 'tsconfig.json')
  assert.equal(snapshot.truncated, false)
  assert.equal(snapshot.compilerOptions.target, 'ES2022')
  assert.equal(snapshot.compilerOptions.moduleResolution, 'Bundler')
  assert.equal(snapshot.compilerOptions.baseUrl, '.')
  assert.deepEqual(snapshot.compilerOptions.paths, { '@/*': ['src/*'] })
  assert.ok(indexedPaths.has('src/App.tsx'))
  assert.ok(indexedPaths.has('src/local.ts'))
  assert.ok(indexedPaths.has('src/settings.json'))
  assert.ok(indexedPaths.has('node_modules/fixture-package/package.json'))
  assert.ok(indexedPaths.has('node_modules/fixture-package/index.d.ts'))
  assert.ok(indexedPaths.has('node_modules/fixture-dep/index.d.ts'))
})

test('workspace TypeScript project uses the nearest config for nested projects', async (t) => {
  const workspaceRootPath = await mkdtemp(path.join(os.tmpdir(), 'tidecode-ts-nearest-'))
  t.after(async () => {
    clearWorkspaceTypeScriptProjectCache()
    await rm(workspaceRootPath, { recursive: true, force: true })
  })

  await writeFixtureFile(workspaceRootPath, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020' } }))
  await writeFixtureFile(workspaceRootPath, 'packages/web/tsconfig.json', JSON.stringify({
    compilerOptions: { moduleResolution: 'Bundler', target: 'ES2022' },
  }))
  await writeFixtureFile(workspaceRootPath, 'packages/web/src/index.ts', 'export const value = 1\n')

  const snapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'packages/web/src/index.ts',
    workspaceRootPath,
  })

  assert.equal(snapshot.configPath, 'packages/web/tsconfig.json')
  assert.equal(snapshot.compilerOptions.target, 'ES2022')
  assert.equal(snapshot.compilerOptions.moduleResolution, 'Bundler')
})

test('workspace TypeScript project cache invalidation refreshes changed source files', async (t) => {
  const workspaceRootPath = await mkdtemp(path.join(os.tmpdir(), 'tidecode-ts-cache-'))
  t.after(async () => {
    clearWorkspaceTypeScriptProjectCache()
    await rm(workspaceRootPath, { recursive: true, force: true })
  })

  await writeFixtureFile(workspaceRootPath, 'tsconfig.json', JSON.stringify({
    compilerOptions: { moduleResolution: 'Bundler', target: 'ES2022' },
  }))
  await writeFixtureFile(workspaceRootPath, 'src/index.ts', 'export const value = 1\n')

  const firstSnapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'src/index.ts',
    workspaceRootPath,
  })
  assert.equal(firstSnapshot.files.find((file) => file.filePath === 'src/index.ts')?.content, 'export const value = 1\n')

  await writeFixtureFile(workspaceRootPath, 'src/index.ts', 'export const value = 2\n')
  const cachedSnapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'src/index.ts',
    workspaceRootPath,
  })
  assert.equal(cachedSnapshot.files.find((file) => file.filePath === 'src/index.ts')?.content, 'export const value = 1\n')

  invalidateWorkspaceTypeScriptProjectCache(workspaceRootPath)
  const refreshedSnapshot = await getWorkspaceTypeScriptProject({
    relativePath: 'src/index.ts',
    workspaceRootPath,
  })
  assert.equal(refreshedSnapshot.files.find((file) => file.filePath === 'src/index.ts')?.content, 'export const value = 2\n')
})

test('workspace TypeScript module scanner finds static, dynamic, require, and reference imports', () => {
  const source = [
    "import x from 'alpha'",
    "export { y } from './beta'",
'const dynamicValue = import("gamma")',
    "const common = require('delta')",
'/// <reference types="node" />',
  ].join('\n')
  const specifiers = extractWorkspaceTypeScriptModuleSpecifiers(source)
  assert.deepEqual(new Set(specifiers), new Set(['alpha', './beta', 'gamma', 'delta', 'node']))
})
