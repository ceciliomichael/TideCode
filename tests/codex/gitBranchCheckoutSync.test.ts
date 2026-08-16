import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { checkoutGitBranch } from '../../electron/git/service'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function withTemporaryDirectory<T>(callback: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-git-checkout-sync-test-'))

  try {
    return await callback(directoryPath)
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true })
  }
}

async function commitFile(cwd: string, fileName: string, content: string, message: string) {
  await fs.writeFile(path.join(cwd, fileName), content, 'utf8')
  await runGit(['add', '.'], cwd)
  await runGit(['commit', '-m', message], cwd)
}

async function setupRemoteAndClone(tempRootPath: string) {
  const remotePath = path.join(tempRootPath, 'remote.git')
  const seedPath = path.join(tempRootPath, 'seed')
  const clonePath = path.join(tempRootPath, 'clone')

  await fs.mkdir(seedPath)
  await runGit(['init', '--bare', remotePath], tempRootPath)
  await runGit(['init', '-b', 'main'], seedPath)
  await runGit(['config', 'user.name', 'Seed User'], seedPath)
  await runGit(['config', 'user.email', 'seed@example.com'], seedPath)
  await commitFile(seedPath, 'README.md', 'initial\n', 'chore: initial commit')
  await runGit(['remote', 'add', 'origin', remotePath], seedPath)
  await runGit(['push', '-u', 'origin', 'main'], seedPath)
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], remotePath)

  await runGit(['clone', remotePath, clonePath], tempRootPath)
  await runGit(['config', 'user.name', 'Clone User'], clonePath)
  await runGit(['config', 'user.email', 'clone@example.com'], clonePath)
  await runGit(['remote', 'set-head', 'origin', '-a'], clonePath)

  return {
    clonePath,
    seedPath,
  }
}

test('checkoutGitBranch switches locally without fetching or pulling remote commits', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)
    const { stdout: localMainStdout } = await runGit(['rev-parse', 'main'], clonePath)
    const localMainHead = localMainStdout.trim()
    await runGit(['checkout', '-b', 'feature/local-work'], clonePath)

    await commitFile(seedPath, 'README.md', 'initial\nupstream change\n', 'fix: update upstream readme')
    await runGit(['push', 'origin', 'main'], seedPath)
    const { stdout: remoteHeadStdout } = await runGit(['rev-parse', 'HEAD'], seedPath)
    const remoteHead = remoteHeadStdout.trim()
    assert.notEqual(remoteHead, localMainHead)

    const state = await checkoutGitBranch({
      branchName: 'main',
      workspacePath: clonePath,
    })

    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    assert.equal(state.currentBranch, 'main')
    assert.equal(localHeadStdout.trim(), localMainHead)
    assert.notEqual(localHeadStdout.trim(), remoteHead)
  })
})

test('checkoutGitBranch creates a local tracking branch from a known remote-only branch without network access', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)
    await runGit(['checkout', '-b', 'feature/remote-only'], seedPath)
    await commitFile(seedPath, 'remote-only.txt', 'remote branch\n', 'feat: remote-only branch')
    await runGit(['push', '-u', 'origin', 'feature/remote-only'], seedPath)
    await runGit(['fetch', 'origin'], clonePath)
    await runGit(['remote', 'set-url', 'origin', path.join(tempRootPath, 'missing-remote.git')], clonePath)

    const state = await checkoutGitBranch({
      branchName: 'feature/remote-only',
      workspacePath: clonePath,
    })
    const { stdout: upstreamStdout } = await runGit(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      clonePath,
    )

    assert.equal(state.currentBranch, 'feature/remote-only')
    assert.ok(state.branches.includes('feature/remote-only'))
    assert.ok(state.remoteBranches.includes('feature/remote-only'))
    assert.equal(upstreamStdout.trim(), 'origin/feature/remote-only')
    await fs.access(path.join(clonePath, 'remote-only.txt'))
  })
})

test('checkoutGitBranch succeeds when the configured remote is unavailable', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath } = await setupRemoteAndClone(tempRootPath)
    await runGit(['checkout', '-b', 'feature/local-work'], clonePath)
    await runGit(['remote', 'set-url', 'origin', path.join(tempRootPath, 'missing-remote.git')], clonePath)

    const state = await checkoutGitBranch({
      branchName: 'main',
      workspacePath: clonePath,
    })

    assert.equal(state.currentBranch, 'main')
  })
})

test('checkoutGitBranch does not block local switching on remote divergence', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)

    await commitFile(clonePath, 'local.txt', 'local change\n', 'feat: local commit')
    const { stdout: localMainStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    const localMainHead = localMainStdout.trim()
    await runGit(['checkout', '-b', 'feature/local-work'], clonePath)

    await commitFile(seedPath, 'remote.txt', 'remote change\n', 'fix: remote commit')
    await runGit(['push', 'origin', 'main'], seedPath)

    const state = await checkoutGitBranch({
      branchName: 'main',
      workspacePath: clonePath,
    })

    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    assert.equal(state.currentBranch, 'main')
    assert.equal(localHeadStdout.trim(), localMainHead)
    await fs.access(path.join(clonePath, 'local.txt'))
    await assert.rejects(fs.access(path.join(clonePath, 'remote.txt')))
  })
})
