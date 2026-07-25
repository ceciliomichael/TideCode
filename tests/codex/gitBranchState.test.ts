import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getGitBranchState } from '../../electron/git/service'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
}

async function withTemporaryDirectory<T>(callback: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'echosphere-git-branch-state-test-'))

  try {
    return await callback(directoryPath)
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true })
  }
}

test('getGitBranchState returns a branch name for an unborn repository (no commits)', async () => {
  await withTemporaryDirectory(async (workspacePath) => {
    await runGit(['init', '-b', 'main'], workspacePath)

    const state = await getGitBranchState(workspacePath)
    const resolvedWorkspacePath = await fs.realpath(workspacePath)
    const resolvedRepoRootPath = await fs.realpath(state.repoRootPath ?? '')

    assert.equal(state.hasRepository, true)
    assert.equal(resolvedRepoRootPath.toLowerCase(), resolvedWorkspacePath.toLowerCase())
    assert.equal(state.currentBranch, 'main')
    assert.equal(state.isDetachedHead, false)
    assert.deepEqual(state.branches, [])
  })
})

test('getGitBranchState reports detached HEAD with a short SHA', async () => {
  await withTemporaryDirectory(async (workspacePath) => {
    await runGit(['init', '-b', 'main'], workspacePath)
    await runGit(['config', 'user.name', 'Test User'], workspacePath)
    await runGit(['config', 'user.email', 'test@example.com'], workspacePath)
    await fs.writeFile(path.join(workspacePath, 'README.md'), 'hello', 'utf8')
    await runGit(['add', '.'], workspacePath)
    await runGit(['commit', '-m', 'initial'], workspacePath)
    await runGit(['checkout', '--detach'], workspacePath)

    const state = await getGitBranchState(workspacePath)

    assert.equal(state.hasRepository, true)
    assert.equal(state.isDetachedHead, true)
    assert.equal(typeof state.currentBranch, 'string')
    assert.equal(state.currentBranch?.startsWith('detached@'), true)
    assert.ok(state.branches.includes('main'))
  })
})

test('getGitBranchState returns an empty state for non-repositories', async () => {
  await withTemporaryDirectory(async (workspacePath) => {
    const state = await getGitBranchState(workspacePath)

    assert.equal(state.hasRepository, false)
    assert.equal(state.aheadCommitCount, 0)
    assert.equal(state.behindCommitCount, 0)
    assert.equal(state.hasUpstream, false)
    assert.equal(state.repoRootPath, null)
    assert.equal(state.currentBranch, null)
    assert.equal(state.isDetachedHead, false)
    assert.deepEqual(state.branches, [])
  })
})

test('getGitBranchState reports outgoing commits relative to the configured upstream', async () => {
  await withTemporaryDirectory(async (workspacePath) => {
    const remotePath = path.join(workspacePath, 'remote.git')
    const repoPath = path.join(workspacePath, 'repo')
    await fs.mkdir(repoPath)
    await runGit(['init', '--bare', remotePath], workspacePath)
    await runGit(['init', '-b', 'main'], repoPath)
    await runGit(['config', 'user.name', 'Test User'], repoPath)
    await runGit(['config', 'user.email', 'test@example.com'], repoPath)
    await fs.writeFile(path.join(repoPath, 'README.md'), 'one\n', 'utf8')
    await runGit(['add', '.'], repoPath)
    await runGit(['commit', '-m', 'initial'], repoPath)
    await runGit(['remote', 'add', 'origin', remotePath], repoPath)
    await runGit(['push', '-u', 'origin', 'main'], repoPath)
    await fs.writeFile(path.join(repoPath, 'README.md'), 'one\ntwo\n', 'utf8')
    await runGit(['add', '.'], repoPath)
    await runGit(['commit', '-m', 'local change'], repoPath)

    const state = await getGitBranchState(repoPath)

    assert.equal(state.hasUpstream, true)
    assert.equal(state.aheadCommitCount, 1)
    assert.equal(state.behindCommitCount, 0)
  })
})
