import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { gitCommit } from '../../electron/git/serviceCommit'

const execFileAsync = promisify(execFile)

async function withRepository(callback: (repoPath: string, git: (args: string[]) => Promise<string>) => Promise<void>) {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'tidecode-commit-safety-'))
  const git = async (args: string[]) => (await execFileAsync('git', args, { cwd: repoPath })).stdout

  try {
    await git(['init', '-b', 'main'])
    await git(['config', 'user.name', 'Test User'])
    await git(['config', 'user.email', 'test@example.com'])
    await writeFile(path.join(repoPath, 'tracked.txt'), 'base\n')
    await git(['add', 'tracked.txt'])
    await git(['commit', '-m', 'base'])
    await callback(repoPath, git)
  } finally {
    await rm(repoPath, { force: true, recursive: true })
  }
}

test('commit refuses an unstaged-only worktree without explicit consent', async () => {
  await withRepository(async (repoPath, git) => {
    await writeFile(path.join(repoPath, 'untracked.txt'), 'do not include\n')
    const originalHead = (await git(['rev-parse', 'HEAD'])).trim()

    await assert.rejects(
      gitCommit({ action: 'commit', message: 'test: should refuse', workspacePath: repoPath }),
      /No staged changes/,
    )
    assert.equal((await git(['rev-parse', 'HEAD'])).trim(), originalHead)
    assert.match(await git(['status', '--short']), /\?\? untracked\.txt/)
  })
})

test('commit only includes staged changes unless inclusion is requested', async () => {
  await withRepository(async (repoPath, git) => {
    await writeFile(path.join(repoPath, 'tracked.txt'), 'staged\n')
    await git(['add', 'tracked.txt'])
    await writeFile(path.join(repoPath, 'excluded.txt'), 'not staged\n')

    await gitCommit({ action: 'commit', message: 'test: staged only', workspacePath: repoPath })
    assert.match(await git(['show', '--pretty=format:', '--name-only', 'HEAD']), /tracked\.txt/)
    assert.doesNotMatch(await git(['show', '--pretty=format:', '--name-only', 'HEAD']), /excluded\.txt/)
    assert.match(await git(['status', '--short']), /\?\? excluded\.txt/)
  })
})

test('failed push reports a completed local commit without losing the result', async () => {
  await withRepository(async (repoPath, git) => {
    await writeFile(path.join(repoPath, 'tracked.txt'), 'new content\n')

    const result = await gitCommit({
      action: 'commit-and-push',
      includeUnstaged: true,
      message: 'test: local commit still succeeded',
      workspacePath: repoPath,
    })

    assert.equal(result.success, true)
    assert.match(result.postCommitWarning ?? '', /Committed locally, but push failed/)
    assert.match(await git(['log', '-1', '--pretty=%s']), /local commit still succeeded/)
    assert.equal((await git(['status', '--short'])).trim(), '')
  })
})
