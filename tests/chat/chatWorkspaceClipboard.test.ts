import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceClipboardEntry, resolveWorkspaceClipboardPasteInputs, shouldClearWorkspaceClipboardByPathPrefix } from '../../src/pages/chatInterface/chatWorkspaceClipboard'

test('workspace clipboard entries keep their source workspace and normalize paths', () => {
  const clipboard = createWorkspaceClipboardEntry({
    mode: 'copy',
    relativePaths: ['src/app.ts', 'src/app.ts', '  docs/readme.md  '],
    sourceWorkspaceRootPath: '  /projects/alpha  ',
  })

  assert.deepEqual(clipboard, {
    mode: 'copy',
    relativePaths: ['src/app.ts', 'docs/readme.md'],
    sourceWorkspaceRootPath: '/projects/alpha',
  })
})

test('workspace clipboard copy stays a workspace transfer when pasting into the same project', () => {
  const clipboard = createWorkspaceClipboardEntry({
    mode: 'copy',
    relativePaths: ['src/app.ts'],
    sourceWorkspaceRootPath: '/projects/alpha',
  })

  const pasteInputs = resolveWorkspaceClipboardPasteInputs({
    clipboard,
    targetDirectoryRelativePath: 'notes',
    workspaceRootPath: '/projects/alpha',
  })

  assert.deepEqual(pasteInputs, [
    {
      kind: 'transfer',
      input: {
        mode: 'copy',
        relativePath: 'src/app.ts',
        targetDirectoryRelativePath: 'notes',
        workspaceRootPath: '/projects/alpha',
      },
    },
  ])
})

test('workspace clipboard copy from another project resolves to import paths', () => {
  const clipboard = createWorkspaceClipboardEntry({
    mode: 'copy',
    relativePaths: ['src/app.ts'],
    sourceWorkspaceRootPath: 'C:\\projects\\alpha',
  })

  const pasteInputs = resolveWorkspaceClipboardPasteInputs({
    clipboard,
    targetDirectoryRelativePath: 'notes',
    workspaceRootPath: 'D:\\projects\\beta',
  })

  assert.deepEqual(pasteInputs, [
    {
      kind: 'import',
      input: {
        sourcePath: 'C:/projects/alpha/src/app.ts',
        targetDirectoryRelativePath: 'notes',
        workspaceRootPath: 'D:\\projects\\beta',
      },
    },
  ])
})

test('workspace clipboard cut entries cannot be pasted into a different project', () => {
  const clipboard = createWorkspaceClipboardEntry({
    mode: 'cut',
    relativePaths: ['src/app.ts'],
    sourceWorkspaceRootPath: '/projects/alpha',
  })

  assert.throws(
    () =>
      resolveWorkspaceClipboardPasteInputs({
        clipboard,
        targetDirectoryRelativePath: 'notes',
        workspaceRootPath: '/projects/beta',
      }),
    /Cannot paste a cut entry into a different project\./,
  )
})

test('workspace clipboard cleanup only applies to entries in the active source workspace', () => {
  const clipboard = createWorkspaceClipboardEntry({
    mode: 'copy',
    relativePaths: ['src/app.ts'],
    sourceWorkspaceRootPath: '/projects/alpha',
  })

  assert.equal(
    shouldClearWorkspaceClipboardByPathPrefix({
      clipboard,
      targetPath: 'src',
      workspaceRootPath: '/projects/alpha',
    }),
    true,
  )
  assert.equal(
    shouldClearWorkspaceClipboardByPathPrefix({
      clipboard,
      targetPath: 'src',
      workspaceRootPath: '/projects/beta',
    }),
    false,
  )
})
