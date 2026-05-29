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
