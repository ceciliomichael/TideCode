import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { discardGitFileChanges } from '../../electron/git/service'

const execFileAsync = promisify(execFile)

async function runGit(args: string[], cwd: string) {
  return execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
}

async function withTemporaryDirectory<T>(callback: (directoryPath: string) => Promise<T>) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-git-discard-test-'))

  try {
    return await callback(directoryPath)
  } finally {
    await fs.rm(directoryPath, { force: true, recursive: true })
  }
}

async function createCommittedRepository(directoryPath: string) {
  await runGit(['init', '-b', 'main'], directoryPath)
  await runGit(['config', 'user.name', 'TideCode Test'], directoryPath)
  await runGit(['config', 'user.email', 'tidecode-test@example.com'], directoryPath)
  await fs.writeFile(path.join(directoryPath, 'example.txt'), 'head\n', 'utf8')
  await runGit(['add', 'example.txt'], directoryPath)
  await runGit(['commit', '-m', 'initial'], directoryPath)
}

test('discarding an unstaged mixed change restores the staged index content', async () => {
  await withTemporaryDirectory(async (workspacePath) => {
    await createCommittedRepository(workspacePath)

    await fs.writeFile(path.join(workspacePath, 'example.txt'), 'staged\n', 'utf8')
    await runGit(['add', 'example.txt'], workspacePath)

    // This is the state left when a chat revert changes a file that was
    // already staged: HEAD and the worktree match, while the index differs.
    await fs.writeFile(path.join(workspacePath, 'example.txt'), 'head\n', 'utf8')
    const { stdout: statusBefore } = await runGit(['status', '--short', '--', 'example.txt'], workspacePath)
    assert.match(statusBefore.trim(), /^MM\s+example\.txt$/u)

    await discardGitFileChanges({
      filePath: 'example.txt',
      workspacePath,
    })

    assert.equal(await fs.readFile(path.join(workspacePath, 'example.txt'), 'utf8'), 'staged\n')
    const { stdout: statusAfter } = await runGit(['status', '--short', '--', 'example.txt'], workspacePath)
    assert.match(statusAfter.trim(), /^M\s+example\.txt$/u)
    const { stdout: stagedContent } = await runGit(['show', ':example.txt'], workspacePath)
    assert.equal(stagedContent, 'staged\n')
  })
})

test('discarding an unstaged-only tracked change restores HEAD and removes untracked files', async () => {
  await withTemporaryDirectory(async (workspacePath) => {
    await createCommittedRepository(workspacePath)

    await fs.writeFile(path.join(workspacePath, 'example.txt'), 'unstaged\n', 'utf8')
    await fs.writeFile(path.join(workspacePath, 'untracked.txt'), 'remove me\n', 'utf8')

    await discardGitFileChanges({
      filePath: 'example.txt',
      workspacePath,
    })
    await discardGitFileChanges({
      filePath: 'untracked.txt',
      workspacePath,
    })

    assert.equal(await fs.readFile(path.join(workspacePath, 'example.txt'), 'utf8'), 'head\n')
    await assert.rejects(fs.access(path.join(workspacePath, 'untracked.txt')))
    const { stdout: statusAfter } = await runGit(['status', '--short'], workspacePath)
    assert.equal(statusAfter.trim(), '')
  })
})
