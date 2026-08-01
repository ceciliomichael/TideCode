import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { ConversationFolderRecord } from '../../src/types/chat'
import { filterResolvableFolderRecords } from '../../electron/history/folderPathPruning'

function buildFolderRecord(overrides: Partial<ConversationFolderRecord> & Pick<ConversationFolderRecord, 'id' | 'name' | 'path'>): ConversationFolderRecord {
  return {
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test('filterResolvableFolderRecords removes folders whose paths no longer resolve', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-folder-store-prune-'))
  const existingFolderPath = path.join(tempRootPath, 'existing-folder')
  const missingFolderPath = path.join(tempRootPath, 'missing-folder')

  try {
    await fs.mkdir(existingFolderPath)

    const folders = [
      buildFolderRecord({ id: 'existing', name: 'Existing', path: existingFolderPath }),
      buildFolderRecord({ id: 'missing', name: 'Missing', path: missingFolderPath }),
    ]

    const filteredFolders = await filterResolvableFolderRecords(folders)

    assert.deepEqual(
      filteredFolders.map((folder) => folder.id),
      ['existing'],
    )
    assert.equal(filteredFolders[0]?.path, existingFolderPath)
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
