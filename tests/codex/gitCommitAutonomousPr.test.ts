import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { gitCommit } from '../../electron/git/service'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function withTemporaryDirectory<T>(callback: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-git-commit-pr-test-'))

  try {
    return await callback(directoryPath)
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true })
  }
}

async function setupRepositoryWithRemote(tempRootPath: string, remoteName: string) {
  const remotePath = path.join(tempRootPath, 'remote.git')
  const repoPath = path.join(tempRootPath, 'repo')

  await fs.mkdir(repoPath)
  await runGit(['init', '--bare', remotePath], tempRootPath)
  await runGit(['init', '-b', 'main'], repoPath)
  await runGit(['config', 'user.name', 'Test User'], repoPath)
  await runGit(['config', 'user.email', 'test@example.com'], repoPath)

  await fs.writeFile(path.join(repoPath, 'README.md'), 'initial\n', 'utf8')
  await runGit(['add', '.'], repoPath)
  await runGit(['commit', '-m', 'chore: initial commit'], repoPath)
  await runGit(['remote', 'add', remoteName, remotePath], repoPath)
  await runGit(['push', '-u', remoteName, 'main'], repoPath)
  await runGit(['symbolic-ref', 'HEAD', 'refs/heads/main'], remotePath)
  await runGit(['fetch', remoteName], repoPath)
  await runGit(['remote', 'set-head', remoteName, '-a'], repoPath)

  return {
    remotePath,
    repoPath,
  }
}

async function setupRepositoryWithOrigin(tempRootPath: string) {
  return setupRepositoryWithRemote(tempRootPath, 'origin')
}

test('gitCommit auto-creates a feature branch for commit-and-create-pr on default branch', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { repoPath } = await setupRepositoryWithOrigin(tempRootPath)

    await fs.writeFile(path.join(repoPath, 'src.txt'), 'hello world\n', 'utf8')

    const result = await gitCommit({
      action: 'commit-and-create-pr',
      message: 'fix: support autonomous PR commits',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    assert.equal(typeof result.commitHash, 'string')
    assert.equal(result.commitHash.length > 0, true)
    assert.equal(typeof result.branchName, 'string')
    assert.equal(result.branchName?.startsWith('fix/'), true)
    assert.notEqual(result.branchName, 'main')
    assert.equal(result.defaultBranchName, 'main')
    assert.equal(result.switchedToDefaultBranch, true)
    assert.equal(result.pulledLatestOnDefaultBranch, true)
    assert.equal(result.postCommitWarning, null)

    const { stdout: currentBranchStdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    assert.equal(currentBranchStdout.trim(), 'main')

    const { stdout: remoteBranchStdout } = await runGit(['ls-remote', '--heads', 'origin', result.branchName!], repoPath)
    assert.equal(remoteBranchStdout.includes(`refs/heads/${result.branchName}`), true)
  })
})

test('gitCommit creates PR branches when the preferred remote is not named origin', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const remoteName = 'tidecode'
    const { repoPath } = await setupRepositoryWithRemote(tempRootPath, remoteName)
    await fs.writeFile(path.join(repoPath, 'named-remote.txt'), 'named remote work\n', 'utf8')

    const result = await gitCommit({
      action: 'commit-and-create-pr',
      message: 'fix: support named git remotes for pull requests',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    assert.equal(typeof result.branchName, 'string')
    assert.notEqual(result.branchName, 'main')

    const { stdout: remoteBranchStdout } = await runGit(['ls-remote', '--heads', remoteName, result.branchName!], repoPath)
    assert.equal(remoteBranchStdout.includes(`refs/heads/${result.branchName}`), true)

    const { stdout: currentBranchStdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    assert.equal(currentBranchStdout.trim(), 'main')
  })
})

test('gitCommit respects preferredBranchName when creating PR commits', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { repoPath } = await setupRepositoryWithOrigin(tempRootPath)
    await fs.writeFile(path.join(repoPath, 'feature.txt'), 'feature work\n', 'utf8')

    const result = await gitCommit({
      action: 'commit-and-create-pr',
      message: 'feat: add preferred branch support',
      preferredBranchName: 'feat/custom-branch',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    assert.equal(result.branchName, 'feat/custom-branch')
    assert.equal(result.defaultBranchName, 'main')
    assert.equal(result.switchedToDefaultBranch, true)
    assert.equal(result.pulledLatestOnDefaultBranch, true)
    assert.equal(result.postCommitWarning, null)

    const { stdout: currentBranchStdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    assert.equal(currentBranchStdout.trim(), 'main')
  })
})

test('gitCommit keeps manual commit messages exactly as provided', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const repoPath = path.join(tempRootPath, 'repo-manual-message')
    await fs.mkdir(repoPath)
    await runGit(['init', '-b', 'main'], repoPath)
    await runGit(['config', 'user.name', 'Test User'], repoPath)
    await runGit(['config', 'user.email', 'test@example.com'], repoPath)

    await fs.writeFile(path.join(repoPath, 'README.md'), 'hello\n', 'utf8')
    await gitCommit({
      action: 'commit',
      message: 'fix: tighten commit pipeline formatting',
      workspacePath: repoPath,
    })

    const { stdout } = await runGit(['log', '-1', '--pretty=%B'], repoPath)
    assert.equal(stdout.trim(), 'fix: tighten commit pipeline formatting')
  })
})

test('gitCommit creates and checks out a preferred branch for a local commit', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { repoPath } = await setupRepositoryWithOrigin(tempRootPath)
    await fs.writeFile(path.join(repoPath, 'local-feature.txt'), 'local feature work\n', 'utf8')

    const result = await gitCommit({
      action: 'commit',
      message: 'feat: add local preferred branch support',
      preferredBranchName: 'feat/local-branch',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    assert.equal(result.branchName, 'feat/local-branch')

    const { stdout: currentBranchStdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    assert.equal(currentBranchStdout.trim(), 'feat/local-branch')
  })
})

test('gitCommit commit-and-push preserves the selected branch and its configured upstream', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { repoPath } = await setupRepositoryWithOrigin(tempRootPath)
    await runGit(['push', 'origin', 'main:shared-target'], repoPath)
    await runGit(['fetch', 'origin'], repoPath)
    await runGit(['checkout', '-b', 'local-work'], repoPath)
    await runGit(['branch', '--set-upstream-to', 'origin/shared-target', 'local-work'], repoPath)
    await fs.writeFile(path.join(repoPath, 'selected-branch.txt'), 'selected branch work\n', 'utf8')

    const result = await gitCommit({
      action: 'commit-and-push',
      message: 'fix: preserve selected branch upstream',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    assert.equal(result.branchName, 'local-work')

    const { stdout: currentBranchStdout } = await runGit(['symbolic-ref', '--short', 'HEAD'], repoPath)
    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], repoPath)
    const { stdout: targetRemoteStdout } = await runGit(['ls-remote', '--heads', 'origin', 'shared-target'], repoPath)
    const { stdout: unexpectedRemoteStdout } = await runGit(['ls-remote', '--heads', 'origin', 'local-work'], repoPath)

    assert.equal(currentBranchStdout.trim(), 'local-work')
    assert.equal(targetRemoteStdout.startsWith(localHeadStdout.trim()), true)
    assert.equal(unexpectedRemoteStdout.trim(), '')
  })
})
