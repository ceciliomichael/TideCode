import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createWorkspaceCheckpointStore } from '../../electron/workspace/checkpoints'

test('workspace checkpoints restore and redo created, updated, and deleted files', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const checkpointStorageRootPath = path.join(tempRootPath, 'checkpoint-storage')
  const updatedFilePath = path.join(workspaceRootPath, 'src', 'updated.ts')
  const deletedFilePath = path.join(workspaceRootPath, 'src', 'deleted.ts')
  const createdFilePath = path.join(workspaceRootPath, 'generated', 'created.ts')

  await fs.mkdir(path.dirname(updatedFilePath), { recursive: true })
  await fs.writeFile(updatedFilePath, 'export const version = "before";\n', 'utf8')
  await fs.writeFile(deletedFilePath, 'delete me\n', 'utf8')

  const checkpointStore = createWorkspaceCheckpointStore(checkpointStorageRootPath)
  const checkpoint = await checkpointStore.createCheckpoint({
    workspaceRootPath,
  })

  try {
    await checkpointStore.captureFileState(checkpoint.id, updatedFilePath)
    await checkpointStore.captureFileState(checkpoint.id, deletedFilePath)
    await checkpointStore.captureFileState(checkpoint.id, createdFilePath)

    await fs.writeFile(updatedFilePath, 'export const version = "after";\n', 'utf8')
    await fs.rm(deletedFilePath)
    await fs.mkdir(path.dirname(createdFilePath), { recursive: true })
    await fs.writeFile(createdFilePath, 'export const created = true;\n', 'utf8')

    const redoCheckpoint = await checkpointStore.createRedoCheckpointFromSource(checkpoint.id)

    await checkpointStore.restoreCheckpoint(checkpoint.id)

    await assert.rejects(fs.readFile(createdFilePath, 'utf8'), { code: 'ENOENT' })
    await assert.rejects(fs.stat(path.dirname(createdFilePath)), { code: 'ENOENT' })
    assert.equal(await fs.readFile(updatedFilePath, 'utf8'), 'export const version = "before";\n')
    assert.equal(await fs.readFile(deletedFilePath, 'utf8'), 'delete me\n')

    await checkpointStore.restoreCheckpoint(redoCheckpoint.id)

    assert.equal(await fs.readFile(updatedFilePath, 'utf8'), 'export const version = "after";\n')
    await assert.rejects(fs.readFile(deletedFilePath, 'utf8'), { code: 'ENOENT' })
    assert.equal(await fs.readFile(createdFilePath, 'utf8'), 'export const created = true;\n')
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoint sequences rewind multiple turns and can be redone', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-sequence-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const checkpointStorageRootPath = path.join(tempRootPath, 'checkpoint-storage')
  const firstCreatedFilePath = path.join(workspaceRootPath, 'hello.txt')
  const secondCreatedFilePath = path.join(workspaceRootPath, 'hi.txt')

  const checkpointStore = createWorkspaceCheckpointStore(checkpointStorageRootPath)
  await fs.mkdir(workspaceRootPath, { recursive: true })
  const firstCheckpoint = await checkpointStore.createCheckpoint({
    workspaceRootPath,
  })

  try {
    await checkpointStore.captureFileState(firstCheckpoint.id, firstCreatedFilePath)
    await fs.mkdir(path.dirname(firstCreatedFilePath), { recursive: true })
    await fs.writeFile(firstCreatedFilePath, 'hello\n', 'utf8')

    const secondCheckpoint = await checkpointStore.createCheckpoint({
      workspaceRootPath,
    })
    await checkpointStore.captureFileState(secondCheckpoint.id, secondCreatedFilePath)
    await fs.writeFile(secondCreatedFilePath, 'hi\n', 'utf8')

    const redoCheckpoint = await checkpointStore.createRedoCheckpointFromSources([firstCheckpoint.id, secondCheckpoint.id])

    await checkpointStore.restoreCheckpointSequence([firstCheckpoint.id, secondCheckpoint.id])

    await assert.rejects(fs.readFile(firstCreatedFilePath, 'utf8'), { code: 'ENOENT' })
    await assert.rejects(fs.readFile(secondCreatedFilePath, 'utf8'), { code: 'ENOENT' })

    await checkpointStore.restoreCheckpoint(redoCheckpoint.id)

    assert.equal(await fs.readFile(firstCreatedFilePath, 'utf8'), 'hello\n')
    assert.equal(await fs.readFile(secondCreatedFilePath, 'utf8'), 'hi\n')
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints surface a friendly error when the manifest file is unreadable', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-corrupt-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const checkpointStorageRootPath = path.join(tempRootPath, 'checkpoint-storage')

  const checkpointStore = createWorkspaceCheckpointStore(checkpointStorageRootPath)
  await fs.mkdir(workspaceRootPath, { recursive: true })
  const checkpoint = await checkpointStore.createCheckpoint({
    workspaceRootPath,
  })

  const manifestPath = path.join(
    checkpointStorageRootPath,
    'workspace-checkpoints',
    checkpoint.id,
    'manifest.json',
  )

  try {
    await fs.writeFile(manifestPath, '', 'utf8')

    await assert.rejects(
      checkpointStore.restoreCheckpoint(checkpoint.id),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Checkpoint manifest is unreadable:'),
    )
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints ignore files outside the workspace root gracefully', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-outside-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const checkpointStorageRootPath = path.join(tempRootPath, 'checkpoint-storage')
  const outsideFilePath = path.join(tempRootPath, 'outside.txt')

  await fs.mkdir(workspaceRootPath, { recursive: true })
  await fs.writeFile(outsideFilePath, 'outside content\n', 'utf8')

  const checkpointStore = createWorkspaceCheckpointStore(checkpointStorageRootPath)
  const checkpoint = await checkpointStore.createCheckpoint({
    workspaceRootPath,
  })

  try {
    // This should not throw an error, even though outsideFilePath is outside workspaceRootPath
    await checkpointStore.captureFileState(checkpoint.id, outsideFilePath)
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints undo terminal executions creating folders, files, or modifying existing content', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-terminal-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const existingFilePath = path.join(workspaceRootPath, 'src', 'app.ts')
  const createdFolderDir = path.join(workspaceRootPath, 'my-new-folder')
  const createdInFolderFilePath = path.join(createdFolderDir, 'nested', 'component.tsx')

  await fs.mkdir(path.dirname(existingFilePath), { recursive: true })
  await fs.writeFile(existingFilePath, 'original content\n', 'utf8')

  const {
    captureWorkspaceCheckpointTerminalPostState,
    captureWorkspaceCheckpointTerminalPreState,
    createWorkspaceCheckpointStore,
  } = await import('../../electron/workspace/checkpoints')

  const checkpointStore = createWorkspaceCheckpointStore(path.join(tempRootPath, 'checkpoints'))
  const checkpoint = await checkpointStore.createCheckpoint({ workspaceRootPath })

  try {
    // 1. Terminal execution pre-state capture
    await captureWorkspaceCheckpointTerminalPreState(checkpoint.id, workspaceRootPath, checkpointStore)

    // 2. Simulate terminal execution creating folder and files, and updating existing file
    await fs.writeFile(existingFilePath, 'modified by terminal\n', 'utf8')
    await fs.mkdir(path.dirname(createdInFolderFilePath), { recursive: true })
    await fs.writeFile(createdInFolderFilePath, 'created by terminal\n', 'utf8')

    // 3. Terminal execution post-state capture
    await captureWorkspaceCheckpointTerminalPostState(checkpoint.id, workspaceRootPath, checkpointStore)

    // 4. Restore checkpoint (Revert chat turn)
    await checkpointStore.restoreCheckpoint(checkpoint.id)

    // 5. Verify revert restored original state and completely removed folder and files created by terminal execution
    assert.equal(await fs.readFile(existingFilePath, 'utf8'), 'original content\n')
    await assert.rejects(fs.readFile(createdInFolderFilePath, 'utf8'), { code: 'ENOENT' })
    await assert.rejects(fs.stat(createdFolderDir), { code: 'ENOENT' })
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints remove files copied from outside while preserving the external source', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-copy-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const existingEmptyDirectoryPath = path.join(workspaceRootPath, 'existing-empty-directory')
  const externalSourcePath = path.join(tempRootPath, 'external-source.txt')
  const copiedFilePath = path.join(existingEmptyDirectoryPath, 'copied.txt')
  const checkpointStorageRootPath = path.join(tempRootPath, 'checkpoints')

  await fs.mkdir(existingEmptyDirectoryPath, { recursive: true })
  await fs.writeFile(externalSourcePath, 'external source\n', 'utf8')

  const {
    captureWorkspaceCheckpointTerminalPostState,
    captureWorkspaceCheckpointTerminalPreState,
    createWorkspaceCheckpointStore,
  } = await import('../../electron/workspace/checkpoints')
  const checkpointStore = createWorkspaceCheckpointStore(checkpointStorageRootPath)
  const checkpoint = await checkpointStore.createCheckpoint({ workspaceRootPath })

  try {
    await captureWorkspaceCheckpointTerminalPreState(checkpoint.id, workspaceRootPath, checkpointStore)
    await fs.copyFile(externalSourcePath, copiedFilePath)
    await captureWorkspaceCheckpointTerminalPostState(checkpoint.id, workspaceRootPath, checkpointStore)
    await checkpointStore.restoreCheckpoint(checkpoint.id)

    await assert.rejects(fs.readFile(copiedFilePath, 'utf8'), { code: 'ENOENT' })
    assert.equal(await fs.readFile(externalSourcePath, 'utf8'), 'external source\n')
    assert.ok((await fs.stat(existingEmptyDirectoryPath)).isDirectory())
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints undo terminal executions that create an empty directory', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-emptydir-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const emptyDirPath = path.join(workspaceRootPath, 'hello')

  await fs.mkdir(workspaceRootPath, { recursive: true })

  const {
    captureWorkspaceCheckpointTerminalPostState,
    captureWorkspaceCheckpointTerminalPreState,
    createWorkspaceCheckpointStore,
  } = await import('../../electron/workspace/checkpoints')

  const checkpointStore = createWorkspaceCheckpointStore(path.join(tempRootPath, 'checkpoints'))
  const checkpoint = await checkpointStore.createCheckpoint({ workspaceRootPath })

  try {
    // 1. Pre-state: workspace has no 'hello' folder
    await captureWorkspaceCheckpointTerminalPreState(checkpoint.id, workspaceRootPath, checkpointStore)

    // 2. Simulate: terminal runs `mkdir hello` — creates an empty directory
    await fs.mkdir(emptyDirPath)

    // 3. Post-state capture
    await captureWorkspaceCheckpointTerminalPostState(checkpoint.id, workspaceRootPath, checkpointStore)

    // 4. Revert
    await checkpointStore.restoreCheckpoint(checkpoint.id)

    // 5. The empty folder must be gone after revert
    await assert.rejects(fs.stat(emptyDirPath), { code: 'ENOENT' })
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints create redo checkpoint successfully when source manifest contains directory entries', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-redodir-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const emptyDirPath = path.join(workspaceRootPath, 'hello')

  await fs.mkdir(workspaceRootPath, { recursive: true })

  const {
    captureWorkspaceCheckpointTerminalPostState,
    captureWorkspaceCheckpointTerminalPreState,
    createWorkspaceCheckpointStore,
  } = await import('../../electron/workspace/checkpoints')

  const checkpointStore = createWorkspaceCheckpointStore(path.join(tempRootPath, 'checkpoints'))
  const checkpoint = await checkpointStore.createCheckpoint({ workspaceRootPath })

  try {
    await captureWorkspaceCheckpointTerminalPreState(checkpoint.id, workspaceRootPath, checkpointStore)
    await fs.mkdir(emptyDirPath)
    await captureWorkspaceCheckpointTerminalPostState(checkpoint.id, workspaceRootPath, checkpointStore)

    // Verify createRedoCheckpointFromSources works without throwing 'Checkpoint capture only supports files'
    const redoCheckpoint = await checkpointStore.createRedoCheckpointFromSources([checkpoint.id])
    assert.ok(redoCheckpoint.id)

    // Restore original checkpoint (deletes hello)
    await checkpointStore.restoreCheckpoint(checkpoint.id)
    await assert.rejects(fs.stat(emptyDirPath), { code: 'ENOENT' })

    // Restore redo checkpoint (re-creates hello)
    await checkpointStore.restoreCheckpoint(redoCheckpoint.id)
    const stats = await fs.stat(emptyDirPath)
    assert.ok(stats.isDirectory())
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('workspace checkpoints do not delete pre-existing files when post-state runs without pre-state capture', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-workspace-checkpoints-noprestate-'))
  const workspaceRootPath = path.join(tempRootPath, 'workspace')
  const existingFilePath = path.join(workspaceRootPath, 'src', 'index.ts')

  await fs.mkdir(path.dirname(existingFilePath), { recursive: true })
  await fs.writeFile(existingFilePath, 'console.log("hello");\n', 'utf8')

  const {
    captureWorkspaceCheckpointTerminalPostState,
    createWorkspaceCheckpointStore,
  } = await import('../../electron/workspace/checkpoints')

  const checkpointStore = createWorkspaceCheckpointStore(path.join(tempRootPath, 'checkpoints'))
  const checkpoint = await checkpointStore.createCheckpoint({ workspaceRootPath })

  try {
    // Post-state runs at end of turn without any terminal pre-state having been captured
    await captureWorkspaceCheckpointTerminalPostState(checkpoint.id, workspaceRootPath, checkpointStore)

    // Restoring checkpoint must preserve pre-existing files, NOT delete them
    await checkpointStore.restoreCheckpoint(checkpoint.id)
    assert.equal(await fs.readFile(existingFilePath, 'utf8'), 'console.log("hello");\n')
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})



