import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createCliConversationRecord } from '../../electron/cli/cliHistory'
import type { CliSessionState } from '../../electron/cli/types'
import { electronApp } from '../../electron/electronApp'
import { readFolderStore } from '../../electron/history/folderStore'
import { ensureStoredFolderFromPath } from '../../electron/history/store'

test('CLI workspace registration reuses one project and assigns new conversations to it', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-cli-project-'))
  const workspacePath = path.join(tempHomePath, 'project1')
  const originalGetPath = electronApp.getPath

  try {
    await fs.mkdir(workspacePath)
    electronApp.getPath = () => tempHomePath

    const firstProject = await ensureStoredFolderFromPath(workspacePath)
    const secondProject = await ensureStoredFolderFromPath(path.join(workspacePath, '.'))
    const storedProjects = await readFolderStore()

    assert.equal(secondProject.id, firstProject.id)
    assert.equal(firstProject.name, 'project1')
    assert.equal(storedProjects.length, 1)

    const state: CliSessionState = {
      activeStreamId: null,
      chatMode: 'agent',
      conversationId: 'cli-project-conversation',
      isStreaming: false,
      messages: [],
      modelId: 'gpt-5.6-luna',
      providerId: 'codex',
      reasoningEffort: 'high',
      terminalExecutionMode: 'full',
      workspaceRootPath: workspacePath,
    }

    const conversation = await createCliConversationRecord(state)
    assert.equal(conversation.folderId, firstProject.id)
    assert.equal(conversation.agentContextRootPath, workspacePath)
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { force: true, recursive: true })
  }
})
