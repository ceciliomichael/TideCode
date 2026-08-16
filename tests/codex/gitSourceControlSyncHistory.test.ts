import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { getGitHistoryCommitDetails, getGitHistoryPage, gitSync } from '../../electron/git/service'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function withTemporaryDirectory<T>(callback: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-git-source-control-test-'))

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

test('gitSync fetch-all fetches refs from every configured remote', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const originPath = path.join(tempRootPath, 'origin.git')
    const upstreamPath = path.join(tempRootPath, 'upstream.git')
    const repoPath = path.join(tempRootPath, 'repo')
    const upstreamSeedPath = path.join(tempRootPath, 'upstream-seed')

    await fs.mkdir(repoPath)
    await fs.mkdir(upstreamSeedPath)

    await runGit(['init', '--bare', originPath], tempRootPath)
    await runGit(['init', '--bare', upstreamPath], tempRootPath)

    await runGit(['init', '-b', 'main'], repoPath)
    await runGit(['config', 'user.name', 'Repo User'], repoPath)
    await runGit(['config', 'user.email', 'repo@example.com'], repoPath)
    await commitFile(repoPath, 'README.md', 'base\n', 'chore: initial commit')
    await runGit(['remote', 'add', 'origin', originPath], repoPath)
    await runGit(['remote', 'add', 'upstream', upstreamPath], repoPath)
    await runGit(['push', '-u', 'origin', 'main'], repoPath)
    await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], originPath)

    await runGit(['init', '-b', 'main'], upstreamSeedPath)
    await runGit(['config', 'user.name', 'Upstream User'], upstreamSeedPath)
    await runGit(['config', 'user.email', 'upstream@example.com'], upstreamSeedPath)
    await commitFile(upstreamSeedPath, 'upstream.txt', 'upstream\n', 'feat: upstream baseline')
    await runGit(['remote', 'add', 'origin', upstreamPath], upstreamSeedPath)
    await runGit(['push', '-u', 'origin', 'main'], upstreamSeedPath)
    await runGit(['checkout', '-b', 'feature/upstream-only'], upstreamSeedPath)
    await commitFile(upstreamSeedPath, 'feature.txt', 'feature\n', 'feat: upstream feature')
    await runGit(['push', '-u', 'origin', 'feature/upstream-only'], upstreamSeedPath)

    const result = await gitSync({
      action: 'fetch-all',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    const { stdout } = await runGit(
      ['show-ref', '--verify', '--', 'refs/remotes/upstream/feature/upstream-only'],
      repoPath,
    )
    assert.equal(stdout.includes('refs/remotes/upstream/feature/upstream-only'), true)
  })
})

test('gitSync pull fast-forwards to latest upstream commit', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)
    await commitFile(seedPath, 'README.md', 'initial\nupdated\n', 'fix: upstream change')
    await runGit(['push', 'origin', 'main'], seedPath)
    const { stdout: remoteHeadStdout } = await runGit(['rev-parse', 'HEAD'], seedPath)

    const result = await gitSync({
      action: 'pull',
      workspacePath: clonePath,
    })

    assert.equal(result.success, true)
    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    assert.equal(localHeadStdout.trim(), remoteHeadStdout.trim())
  })
})

test('gitSync pull surfaces a clear non-fast-forward error on divergence', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)
    await commitFile(clonePath, 'local.txt', 'local change\n', 'feat: local divergence')
    await commitFile(seedPath, 'remote.txt', 'remote change\n', 'fix: upstream divergence')
    await runGit(['push', 'origin', 'main'], seedPath)

    await assert.rejects(
      gitSync({
        action: 'pull',
        workspacePath: clonePath,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        return message.includes('cannot be fast-forwarded')
      },
    )
  })
})

test('gitSync push sets upstream when pushing a new local branch', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const remotePath = path.join(tempRootPath, 'remote.git')
    const repoPath = path.join(tempRootPath, 'repo')

    await fs.mkdir(repoPath)
    await runGit(['init', '--bare', remotePath], tempRootPath)
    await runGit(['init', '-b', 'main'], repoPath)
    await runGit(['config', 'user.name', 'Repo User'], repoPath)
    await runGit(['config', 'user.email', 'repo@example.com'], repoPath)
    await commitFile(repoPath, 'README.md', 'initial\n', 'chore: initial commit')
    await runGit(['remote', 'add', 'origin', remotePath], repoPath)
    await runGit(['push', '-u', 'origin', 'main'], repoPath)
    await runGit(['checkout', '-b', 'feat/new-sync-branch'], repoPath)
    await commitFile(repoPath, 'branch.txt', 'branch\n', 'feat: branch commit')

    const result = await gitSync({
      action: 'push',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    const { stdout: upstreamStdout } = await runGit(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      repoPath,
    )
    assert.equal(upstreamStdout.trim(), 'origin/feat/new-sync-branch')
  })
})

test('gitSync push preserves a differently named configured upstream branch', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath } = await setupRemoteAndClone(tempRootPath)
    await runGit(['push', 'origin', 'main:shared-target'], clonePath)
    await runGit(['fetch', 'origin'], clonePath)
    await runGit(['checkout', '-b', 'local-work'], clonePath)
    await runGit(['branch', '--set-upstream-to', 'origin/shared-target', 'local-work'], clonePath)
    await commitFile(clonePath, 'branch.txt', 'branch work\n', 'fix: preserve push upstream')

    const result = await gitSync({
      action: 'push',
      workspacePath: clonePath,
    })

    assert.equal(result.success, true)
    assert.equal(result.branchName, 'local-work')

    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    const { stdout: targetRemoteStdout } = await runGit(['ls-remote', '--heads', 'origin', 'shared-target'], clonePath)
    const { stdout: unexpectedRemoteStdout } = await runGit(['ls-remote', '--heads', 'origin', 'local-work'], clonePath)

    assert.equal(targetRemoteStdout.startsWith(localHeadStdout.trim()), true)
    assert.equal(unexpectedRemoteStdout.trim(), '')
  })
})

test('gitSync sync pushes a committed local change to the tracked remote branch', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)
    await commitFile(clonePath, 'local.txt', 'local sync change\n', 'feat: local sync change')

    const result = await gitSync({
      action: 'sync',
      workspacePath: clonePath,
    })

    assert.equal(result.success, true)
    assert.equal(result.action, 'sync')
    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    const { stdout: remoteHeadStdout } = await runGit(['rev-parse', 'HEAD'], seedPath)
    await runGit(['fetch', 'origin'], seedPath)
    const { stdout: refreshedRemoteHeadStdout } = await runGit(['rev-parse', 'origin/main'], seedPath)
    assert.notEqual(remoteHeadStdout.trim(), localHeadStdout.trim())
    assert.equal(refreshedRemoteHeadStdout.trim(), localHeadStdout.trim())
  })
})

test('gitSync sync pulls a remote fast-forward before completing', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)
    await commitFile(seedPath, 'remote.txt', 'remote sync change\n', 'feat: remote sync change')
    await runGit(['push', 'origin', 'main'], seedPath)

    const result = await gitSync({
      action: 'sync',
      workspacePath: clonePath,
    })

    assert.equal(result.success, true)
    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    const { stdout: remoteHeadStdout } = await runGit(['rev-parse', 'HEAD'], seedPath)
    assert.equal(localHeadStdout.trim(), remoteHeadStdout.trim())
  })
})

test('getGitHistoryPage returns paginated history entries with head metadata', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const repoPath = path.join(tempRootPath, 'history-repo')
    await fs.mkdir(repoPath)
    await runGit(['init', '-b', 'main'], repoPath)
    await runGit(['config', 'user.name', 'History User'], repoPath)
    await runGit(['config', 'user.email', 'history@example.com'], repoPath)

    await commitFile(repoPath, 'README.md', 'one\n', 'chore: first')
    await commitFile(repoPath, 'README.md', 'one\ntwo\n', 'feat: second')
    await commitFile(repoPath, 'README.md', 'one\ntwo\nthree\n', 'fix: third')

    const pageOne = await getGitHistoryPage({
      limit: 2,
      offset: 0,
      workspacePath: repoPath,
    })
    const pageTwo = await getGitHistoryPage({
      limit: 2,
      offset: 2,
      workspacePath: repoPath,
    })

    const { stdout: headStdout } = await runGit(['rev-parse', 'HEAD'], repoPath)
    const headHash = headStdout.trim()

    assert.equal(pageOne.hasRepository, true)
    assert.equal(pageOne.entries.length, 2)
    assert.equal(pageOne.hasMore, true)
    assert.equal(pageOne.headHash, headHash)
    assert.equal(pageOne.entries.some((entry) => entry.isHead), true)
    assert.equal(pageTwo.entries.length >= 1, true)
    assert.equal(pageTwo.entries.every((entry) => entry.hash.length > 0), true)
  })
})

test('getGitHistoryCommitDetails returns changed files for an expanded history entry', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const repoPath = path.join(tempRootPath, 'details-repo')
    await fs.mkdir(repoPath)
    await runGit(['init', '-b', 'main'], repoPath)
    await runGit(['config', 'user.name', 'Details User'], repoPath)
    await runGit(['config', 'user.email', 'details@example.com'], repoPath)

    await commitFile(repoPath, 'README.md', 'one\n', 'chore: first')
    await fs.mkdir(path.join(repoPath, 'src'))
    await fs.writeFile(path.join(repoPath, 'src', 'service.ts'), 'export const value = 1\n', 'utf8')
    await runGit(['add', '.'], repoPath)
    await runGit(['commit', '-m', 'feat: add service file'], repoPath)

    const { stdout: headStdout } = await runGit(['rev-parse', 'HEAD'], repoPath)
    const details = await getGitHistoryCommitDetails({
      commitHash: headStdout.trim(),
      workspacePath: repoPath,
    })

    assert.equal(details.hasRepository, true)
    assert.equal(details.files.some((file) => file.path === 'src/service.ts'), true)
  })
})
