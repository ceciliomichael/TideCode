import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { getGitDiffSnapshot } from '../../electron/git/serviceDiff'
import { buildFileDiffSnapshot, projectGitFileDiffScope } from '../../src/lib/chatDiffs'

const execFileAsync = promisify(execFile)

test('full Git diff snapshots retain binary untracked files from status snapshots', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'tidecode-git-diff-'))

  try {
    await execFileAsync('git', ['init'], { cwd: repoPath })
    await writeFile(path.join(repoPath, 'example.txt'), 'hello\n', 'utf8')
    await writeFile(path.join(repoPath, 'binary.bin'), Buffer.from([0, 1, 2, 3]))

    const statusSnapshot = await getGitDiffSnapshot(repoPath, { includeContent: false })
    const fullSnapshot = await getGitDiffSnapshot(repoPath, { includeContent: true })

    for (const statusDiff of statusSnapshot.fileDiffs) {
      assert.equal(statusDiff.addedLineCount, statusDiff.fileName === 'example.txt' ? 1 : 0)
      assert.equal(statusDiff.removedLineCount, 0)
    }

    assert.deepEqual(
      fullSnapshot.fileDiffs.map((fileDiff) => fileDiff.fileName).sort(),
      statusSnapshot.fileDiffs.map((fileDiff) => fileDiff.fileName).sort(),
    )
    assert.equal(fullSnapshot.fileDiffs.length, 2)

    const binaryDiff = fullSnapshot.fileDiffs.find((fileDiff) => fileDiff.fileName === 'binary.bin')
    assert.ok(binaryDiff)
    assert.equal(binaryDiff.isUntracked, true)
    assert.equal(binaryDiff.newContent, '')
    assert.equal(binaryDiff.oldContent, null)
    assert.equal(binaryDiff.addedLineCount, 0)
    assert.equal(binaryDiff.removedLineCount, 0)
  } finally {
    await rm(repoPath, { force: true, recursive: true })
  }
})

test('staged and unstaged views show the index and worktree versions separately', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'tidecode-git-index-'))
  try {
    const git = (args: string[]) => execFileAsync('git', args, { cwd: repoPath })
    await git(['init', '-b', 'main'])
    await git(['config', 'user.name', 'Test User'])
    await git(['config', 'user.email', 'test@example.com'])
    await writeFile(path.join(repoPath, 'mixed.txt'), 'head\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'base'])
    await writeFile(path.join(repoPath, 'mixed.txt'), 'staged\n')
    await git(['add', 'mixed.txt'])
    await writeFile(path.join(repoPath, 'mixed.txt'), 'unstaged\n')

    const snapshot = await getGitDiffSnapshot(repoPath)
    const mixed = snapshot.fileDiffs.find((diff) => diff.fileName === 'mixed.txt')
    assert.ok(mixed)
    assert.equal(mixed.isStaged, true)
    assert.equal(mixed.isUnstaged, true)
    assert.equal(mixed.oldContent, 'head\n')
    assert.equal(mixed.indexContent, 'staged\n')
    assert.equal(mixed.newContent, 'unstaged\n')

    const normalized = buildFileDiffSnapshot(snapshot.fileDiffs).fileDiffs[0]
    const staged = projectGitFileDiffScope(normalized, 'staged')
    const unstaged = projectGitFileDiffScope(normalized, 'unstaged')
    assert.equal(staged.oldContent, 'head\n')
    assert.equal(staged.newContent, 'staged\n')
    assert.equal(unstaged.oldContent, 'staged\n')
    assert.equal(unstaged.newContent, 'unstaged\n')
  } finally {
    await rm(repoPath, { force: true, recursive: true })
  }
})

test('Git status snapshots report renamed and unresolved files without losing the names', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'tidecode-git-status-'))
  try {
    const git = (args: string[]) => execFileAsync('git', args, { cwd: repoPath })
    await git(['init', '-b', 'main'])
    await git(['config', 'user.name', 'Test User'])
    await git(['config', 'user.email', 'test@example.com'])
    await writeFile(path.join(repoPath, 'before.txt'), 'rename me\n')
    await writeFile(path.join(repoPath, 'conflict.txt'), 'base\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'base'])
    await git(['mv', 'before.txt', 'after.txt'])
    await writeFile(path.join(repoPath, 'after.txt'), 'rename with edits\n')
    let status = await getGitDiffSnapshot(repoPath, { includeContent: false })
    const renamed = status.fileDiffs.find((file) => file.fileName === 'after.txt')
    assert.equal(renamed?.changeStatus, 'renamed')
    assert.equal(renamed?.originalFileName, 'before.txt')
    assert.equal(renamed?.stagedChangeStatus, 'renamed')
    assert.equal(renamed?.unstagedChangeStatus, 'modified')
    const fullRenamed = buildFileDiffSnapshot((await getGitDiffSnapshot(repoPath)).fileDiffs).fileDiffs[0]
    assert.equal(projectGitFileDiffScope(fullRenamed, 'staged').changeStatus, 'renamed')
    assert.equal(projectGitFileDiffScope(fullRenamed, 'unstaged').changeStatus, 'modified')
    await git(['commit', '-am', 'rename'])

    await git(['checkout', '-b', 'other'])
    await writeFile(path.join(repoPath, 'conflict.txt'), 'other\n')
    await git(['commit', '-am', 'other'])
    await git(['checkout', 'main'])
    await writeFile(path.join(repoPath, 'conflict.txt'), 'main\n')
    await git(['commit', '-am', 'main'])
    await assert.rejects(git(['merge', 'other']))
    status = await getGitDiffSnapshot(repoPath, { includeContent: false })
    const conflicted = status.fileDiffs.find((file) => file.fileName === 'conflict.txt')
    assert.equal(conflicted?.changeStatus, 'conflicted')
    assert.equal(conflicted?.isUnstaged, true)
    assert.equal(conflicted?.isStaged, false)
  } finally {
    await rm(repoPath, { force: true, recursive: true })
  }
})

test('Git status read failures propagate rather than masquerading as a clean repository', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'tidecode-git-broken-status-'))
  try {
    const git = (args: string[]) => execFileAsync('git', args, { cwd: repoPath })
    await git(['init'])
    await writeFile(path.join(repoPath, '.git', 'index'), 'bad index contents')
    await assert.rejects(getGitDiffSnapshot(repoPath, { includeContent: false }))
  } finally {
    await rm(repoPath, { force: true, recursive: true })
  }
})
