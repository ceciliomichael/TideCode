import assert from 'node:assert/strict'
import test from 'node:test'
import type { Monaco } from '@monaco-editor/react'
import type { WorkspaceTypeScriptProjectSnapshot } from '../../../src/types/chat'
import {
  applyWorkspaceMonacoTypeScriptProject,
  isWorkspaceMonacoTypeScriptFileHydrated,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoTypeScriptProject'

function createFakeMonaco() {
  const added: Array<{ content: string; fileUri: string }> = []
  const disposed: string[] = []
  const compilerOptions: unknown[] = []
  const diagnosticsOptions: unknown[] = []

  const defaults = {
    addExtraLib(content: string, fileUri: string) {
      added.push({ content, fileUri })
      return { dispose: () => disposed.push(fileUri) }
    },
    setCompilerOptions(options: unknown) {
      compilerOptions.push(options)
    },
    setDiagnosticsOptions(options: unknown) {
      diagnosticsOptions.push(options)
    },
    setEagerModelSync() {},
  }

  const monaco = {
    editor: { getModels: () => [] },
    languages: {
      typescript: {
        javascriptDefaults: defaults,
        typescriptDefaults: defaults,
      },
    },
  } as unknown as Monaco

  return { added, compilerOptions, diagnosticsOptions, disposed, monaco }
}

function createSnapshot(files: WorkspaceTypeScriptProjectSnapshot['files']): WorkspaceTypeScriptProjectSnapshot {
  return {
    compilerOptions: { moduleResolution: 'Bundler', target: 'ES2022' },
    configPath: 'tsconfig.json',
    files,
    projectKey: 'tsconfig.json',
    truncated: false,
  }
}

test('workspace Monaco retains unchanged TypeScript project libraries between file switches', () => {
  const fake = createFakeMonaco()
  const firstSnapshot = createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
    { content: 'export const b = 1', filePath: 'src/b.ts' },
  ])

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', firstSnapshot)
  assert.equal(fake.added.length, 2)
  assert.equal(fake.compilerOptions.length, 1)
  assert.equal(fake.diagnosticsOptions.length, 1)

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', firstSnapshot)
  assert.equal(fake.added.length, 2)
  assert.equal(fake.disposed.length, 0)
  assert.equal(fake.compilerOptions.length, 1)
  assert.equal(fake.diagnosticsOptions.length, 1)

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
    { content: 'export const b = 2', filePath: 'src/b.ts' },
  ]))
  assert.equal(fake.added.length, 3)
  assert.deepEqual(fake.disposed, ['file:///workspace/src/b.ts'])
})

test('workspace Monaco registers TypeScript resolver paths without URI-encoding package scopes', () => {
  const fake = createFakeMonaco()
  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', createSnapshot([
        { content: '{"name":"@types/react"}', filePath: 'node_modules/@types/react/package.json' },
    { content: 'export = React', filePath: 'node_modules/@types/react/index.d.ts' },
  ]))

  assert.deepEqual(fake.added.map((entry) => entry.fileUri), [
        'file:///workspace/node_modules/@types/react/package.json',
        'file:///workspace/node_modules/@types/react/index.d.ts',
  ])
})

test('workspace Monaco keeps semantic diagnostics suspended until dependency typings are ready', () => {
  const fake = createFakeMonaco()
  const snapshot = createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
  ])

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', snapshot, { semanticReady: false })
  assert.deepEqual(fake.diagnosticsOptions.at(-1), {
    noSemanticValidation: true,
    noSuggestionDiagnostics: false,
    noSyntaxValidation: false,
    onlyVisible: true,
  })

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', snapshot, { semanticReady: true })
  assert.deepEqual(fake.diagnosticsOptions.at(-1), {
    noSemanticValidation: false,
    noSuggestionDiagnostics: false,
    noSyntaxValidation: false,
    onlyVisible: true,
  })
})

test('workspace Monaco remembers fully hydrated files across tab switches', () => {
  const fake = createFakeMonaco()
  const snapshot = createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
    { content: 'export const b = 1', filePath: 'src/b.ts' },
  ])

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', snapshot, {
    activeFilePath: 'src/a.ts',
    semanticReady: true,
  })
  assert.equal(
    isWorkspaceMonacoTypeScriptFileHydrated(fake.monaco, 'typescript', 'C:/repo', 'src/a.ts'),
    true,
  )
  assert.equal(
    isWorkspaceMonacoTypeScriptFileHydrated(fake.monaco, 'typescript', 'C:/repo', 'src/b.ts'),
    false,
  )

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', snapshot, {
    activeFilePath: './src/b.ts',
    semanticReady: true,
  })
  assert.equal(
    isWorkspaceMonacoTypeScriptFileHydrated(fake.monaco, 'typescript', 'C:/repo', 'src/a.ts'),
    true,
  )
  assert.equal(
    isWorkspaceMonacoTypeScriptFileHydrated(fake.monaco, 'typescript', 'C:/repo', 'src/b.ts'),
    true,
  )
})

test('workspace Monaco removes stale project libraries only on a replacement refresh', () => {
  const fake = createFakeMonaco()
  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
    { content: 'export const b = 1', filePath: 'src/b.ts' },
  ]))

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
  ]))
  assert.equal(fake.disposed.length, 0)

  applyWorkspaceMonacoTypeScriptProject(fake.monaco, 'typescript', 'C:/repo', createSnapshot([
    { content: 'export const a = 1', filePath: 'src/a.ts' },
  ]), { replaceMissing: true })
  assert.deepEqual(fake.disposed, ['file:///workspace/src/b.ts'])
})
