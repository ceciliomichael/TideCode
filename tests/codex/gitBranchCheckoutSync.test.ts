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

test('checkoutGitBranch fast-forwards branch with latest origin commits', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)

    await commitFile(seedPath, 'README.md', 'initial\nupstream change\n', 'fix: update upstream readme')
    await runGit(['push', 'origin', 'main'], seedPath)
    const { stdout: remoteHeadStdout } = await runGit(['rev-parse', 'HEAD'], seedPath)
    const remoteHead = remoteHeadStdout.trim()

    await checkoutGitBranch({
      branchName: 'main',
      workspacePath: clonePath,
    })

    const { stdout: localHeadStdout } = await runGit(['rev-parse', 'HEAD'], clonePath)
    assert.equal(localHeadStdout.trim(), remoteHead)
  })
})

test('checkoutGitBranch surfaces divergence when branch cannot fast-forward', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { clonePath, seedPath } = await setupRemoteAndClone(tempRootPath)

    await commitFile(clonePath, 'local.txt', 'local change\n', 'feat: local commit before pulling')
    await commitFile(seedPath, 'remote.txt', 'remote change\n', 'fix: remote commit after local change')
    await runGit(['push', 'origin', 'main'], seedPath)

    await assert.rejects(
      checkoutGitBranch({
        branchName: 'main',
        workspacePath: clonePath,
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        return message.includes("cannot be fast-forwarded from origin")
      },
    )
  })
})
