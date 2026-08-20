import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { publishToRemote } from '../electron/git/servicePublish'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function withTemporaryDirectory<T>(callback: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-git-publish-initial-test-'))

  try {
    return await callback(directoryPath)
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true })
  }
}

async function setupUnbornRepository(tempRootPath: string) {
  const remotePath = path.join(tempRootPath, 'remote.git')
  const repoPath = path.join(tempRootPath, 'repo')

  await fs.mkdir(repoPath)
  await runGit(['init', '--bare', remotePath], tempRootPath)
  await runGit(['init', '-b', 'main'], repoPath)
  await runGit(['config', 'user.name', 'Test User'], repoPath)
  await runGit(['config', 'user.email', 'test@example.com'], repoPath)

  return { remotePath, repoPath }
}

test('publishToRemote derives the first commit message from staged repository changes', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { remotePath, repoPath } = await setupUnbornRepository(tempRootPath)
    const sourceDirectory = path.join(repoPath, 'src')
    await fs.mkdir(sourceDirectory)
    await fs.writeFile(
      path.join(sourceDirectory, 'widgetFactory.ts'),
      [
        'export function createWidgetFactory() {',
        "  return { kind: 'widget' }",
        '}',
        '',
      ].join('\n'),
      'utf8',
    )

    const result = await publishToRemote({
      defaultBranch: 'main',
      remoteUrl: remotePath,
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)

    const { stdout: messageOutput } = await runGit(['log', '-1', '--pretty=%B'], repoPath)
    const commitMessage = messageOutput.trim()
    const subject = commitMessage.split(/\r?\n/u)[0]

    assert.notEqual(subject.toLowerCase(), 'initial commit')
    assert.match(subject, /^(feat|fix|docs|style|refactor|test|build|ci|perf|chore)(\([^)]+\))?!?:\s+\S/u)
    assert.match(commitMessage, /widget|createWidgetFactory/iu)
    assert.equal(commitMessage.includes('\n\n- '), true)

    const { stdout: committedFilesOutput } = await runGit(['show', '--pretty=', '--name-only', 'HEAD'], repoPath)
    assert.equal(committedFilesOutput.replace(/\\/gu, '/').includes('src/widgetFactory.ts'), true)

    const { stdout: remoteBranchOutput } = await runGit(['ls-remote', '--heads', 'origin', 'main'], repoPath)
    assert.equal(remoteBranchOutput.includes('refs/heads/main'), true)
  })
})

test('publishToRemote uses an explicit initialization message when the repository is empty', async () => {
  await withTemporaryDirectory(async (tempRootPath) => {
    const { remotePath, repoPath } = await setupUnbornRepository(tempRootPath)

    await publishToRemote({
      defaultBranch: 'main',
      remoteUrl: remotePath,
      workspacePath: repoPath,
    })

    const { stdout: messageOutput } = await runGit(['log', '-1', '--pretty=%B'], repoPath)
    assert.equal(messageOutput.trim(), 'chore: initialize repository')
  })
})
