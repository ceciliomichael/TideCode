import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceMonacoDiffModelPaths } from '../../../src/components/chat/diffViewer/workspaceMonacoDiffModelCache'

test('workspace Monaco diff model paths are stable for the same content', () => {
  const request = {
    contentSignature: 'old:10:abc|new:12:def',
    filePath: 'src/App.tsx',
    language: 'typescript',
    newContent: 'const next = true',
    oldContent: 'const next = false',
  }

  assert.deepEqual(
    createWorkspaceMonacoDiffModelPaths(request),
    createWorkspaceMonacoDiffModelPaths(request),
  )
})

test('workspace Monaco diff model paths separate files and sides', () => {
  const baseRequest = {
    contentSignature: 'same-content',
    filePath: 'src/App.tsx',
    language: 'typescript',
    newContent: 'const next = true',
    oldContent: 'const next = false',
  }
  const otherFilePaths = createWorkspaceMonacoDiffModelPaths({
    ...baseRequest,
    filePath: 'src/Other.tsx',
  })
  const paths = createWorkspaceMonacoDiffModelPaths(baseRequest)

  assert.notEqual(paths.cacheKey, otherFilePaths.cacheKey)
  assert.notEqual(paths.originalModelPath, paths.modifiedModelPath)
})
