import assert from 'node:assert/strict'
import test from 'node:test'
import { publishToRemote } from '../electron/git/servicePublish'

test('publishToRemote rejects an empty remote URL', async () => {
  await assert.rejects(
    async () => {
      await publishToRemote({
        workspacePath: 'C:\\test\\workspace',
        remoteUrl: '',
      })
    },
    {
      message: 'Remote URL is required.',
    },
  )
})

test('publishToRemote rejects an empty or whitespace-only workspace path', async () => {
  await assert.rejects(
    async () => {
      await publishToRemote({
        workspacePath: '   ',
        remoteUrl: 'https://gitlab.com/user/project.git',
      })
    },
    /Workspace path is required|Repository was initialized but could not be located/u,
  )
})
