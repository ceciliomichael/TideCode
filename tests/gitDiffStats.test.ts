import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseGitNumstat } from '../electron/git/diffStats'
import { getGitDiffSnapshot } from '../electron/git/serviceDiff'

const execFileAsync = promisify(execFile)

test('NUL-delimited numstat preserves rename paths containing tabs and handles binary entries', () => {
  const stats = parseGitNumstat('2\t1\t\0old\tname.ts\0new\tname.ts\0-\t-\timage.png\0')
  assert.deepEqual(stats.get('new\tname.ts'), { addedLineCount: 2, removedLineCount: 1 })
  assert.deepEqual(stats.get('image.png'), { addedLineCount: 0, removedLineCount: 0 })
})

test('status-only snapshots retain visible totals for renames, partial staging, untracked and binary files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tidecode-diff-stats-'))
  const git = (...args: string[]) => execFileAsync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, windowsHide: true })
  try {
    await git('init', '--quiet')
    const original = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n') + '\n'
    await writeFile(path.join(root, 'original.txt'), original)
    await git('add', '.')
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture')
    await git('mv', 'original.txt', 'renamed.txt')
    await writeFile(path.join(root, 'renamed.txt'), original.replace('line 3', 'replacement'))
    await git('add', 'renamed.txt')
    await writeFile(path.join(root, 'renamed.txt'), original.replace('line 3', 'replacement') + 'extra\n')
    await writeFile(path.join(root, 'untracked.txt'), 'one\ntwo')
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]))

    const metadata = await getGitDiffSnapshot(root, { includeContent: false })
    const full = await getGitDiffSnapshot(root)
    assert.equal(metadata.fileDiffs.reduce((sum, file) => sum + (file.addedLineCount ?? 0), 0), 4)
    assert.equal(metadata.fileDiffs.reduce((sum, file) => sum + (file.removedLineCount ?? 0), 0), 1)
    assert.deepEqual(metadata.fileDiffs.map(file => [file.fileName, file.addedLineCount, file.removedLineCount]),
      full.fileDiffs.map(file => [file.fileName, file.addedLineCount, file.removedLineCount]))
    assert.ok(metadata.fileDiffs.every(file => file.newContent === '' && file.oldContent === null && file.indexContent === null))
    assert.equal(metadata.fileDiffs.find(file => file.fileName === 'renamed.txt')?.isStaged, true)
    assert.equal(metadata.fileDiffs.find(file => file.fileName === 'renamed.txt')?.isUnstaged, true)
    const renamed = metadata.fileDiffs.find(file => file.fileName === 'renamed.txt')!
    assert.deepEqual(renamed.stagedLineCounts, { addedLineCount: 1, removedLineCount: 1 })
    assert.deepEqual(renamed.unstagedLineCounts, { addedLineCount: 1, removedLineCount: 0 })
    const untracked = metadata.fileDiffs.find(file => file.fileName === 'untracked.txt')!
    assert.deepEqual(untracked.stagedLineCounts, { addedLineCount: 0, removedLineCount: 0 })
    assert.deepEqual(untracked.unstagedLineCounts, { addedLineCount: 2, removedLineCount: 0 })
    const binary = metadata.fileDiffs.find(file => file.fileName === 'binary.bin')!
    assert.deepEqual(binary.unstagedLineCounts, { addedLineCount: 0, removedLineCount: 0 })
    assert.deepEqual(metadata.fileDiffs.map(file => [file.stagedLineCounts, file.unstagedLineCounts]),
      full.fileDiffs.map(file => [file.stagedLineCounts, file.unstagedLineCounts]))
    await writeFile(path.join(root, 'untracked.txt'), 'changed\n')
    const updated = await getGitDiffSnapshot(root, { includeContent: false })
    assert.equal(updated.fileDiffs.find(file => file.fileName === 'untracked.txt')?.addedLineCount, 1)
    await writeFile(path.join(root, 'renamed.txt'), 'completely rewritten\n')
    const rewritten = await getGitDiffSnapshot(root, { includeContent: false })
    assert.equal(rewritten.fileDiffs.find(file => file.fileName === 'renamed.txt')?.addedLineCount, 1)
    assert.equal(rewritten.fileDiffs.find(file => file.fileName === 'renamed.txt')?.removedLineCount, 10)
    assert.deepEqual(rewritten.fileDiffs.find(file => file.fileName === 'renamed.txt')?.unstagedLineCounts,
      { addedLineCount: 1, removedLineCount: 10 })
    await rm(path.join(root, 'renamed.txt'))
    const deleted = await getGitDiffSnapshot(root, { includeContent: false })
    const deletedRename = deleted.fileDiffs.find(file => file.fileName === 'renamed.txt')!
    assert.equal(deletedRename.removedLineCount, 10)
    assert.deepEqual(deletedRename.stagedLineCounts, { addedLineCount: 1, removedLineCount: 1 })
    assert.deepEqual(deletedRename.unstagedLineCounts, { addedLineCount: 0, removedLineCount: 10 })

  } finally {
    assert.equal(path.dirname(root), os.tmpdir())
    await rm(root, { recursive: true, force: true })
  }
})

test('an unborn repository reports added lines without loading source strings into metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tidecode-diff-stats-'))
  try {
    await execFileAsync('git', ['init', '--quiet'], { cwd: root, windowsHide: true })
    await writeFile(path.join(root, 'first.txt'), 'first\nsecond\n')
    const snapshot = await getGitDiffSnapshot(root, { includeContent: false })
    assert.equal(snapshot.fileDiffs[0]?.addedLineCount, 2)
    assert.equal(snapshot.fileDiffs[0]?.newContent, '')
    assert.deepEqual(snapshot.fileDiffs[0]?.unstagedLineCounts, { addedLineCount: 2, removedLineCount: 0 })
    await execFileAsync('git', ['-c', 'core.autocrlf=false', 'add', '.'], { cwd: root, windowsHide: true })
    await writeFile(path.join(root, 'first.txt'), 'first\nsecond\nthird\n')
    const partial = await getGitDiffSnapshot(root, { includeContent: false })
    assert.equal(partial.fileDiffs[0]?.addedLineCount, 3)
    assert.deepEqual(partial.fileDiffs[0]?.stagedLineCounts, { addedLineCount: 2, removedLineCount: 0 })
    assert.deepEqual(partial.fileDiffs[0]?.unstagedLineCounts, { addedLineCount: 1, removedLineCount: 0 })

  } finally {
    assert.equal(path.dirname(root), os.tmpdir())
    await rm(root, { recursive: true, force: true })
  }
})

test('opposing staged and unstaged edits retain both counts when combined changes cancel', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tidecode-diff-stats-'))
  const git = (...args: string[]) => execFileAsync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, windowsHide: true })
  try {
    await git('init', '--quiet')
    await writeFile(path.join(root, 'cancel.txt'), 'original\n')
    await git('add', '.')
    await git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fixture')
    await writeFile(path.join(root, 'cancel.txt'), 'staged\n')
    await git('add', '.')
    await writeFile(path.join(root, 'cancel.txt'), 'original\n')
    const snapshot = await getGitDiffSnapshot(root, { includeContent: false })
    const row = snapshot.fileDiffs[0]
    assert.equal(row.addedLineCount, 0)
    assert.equal(row.removedLineCount, 0)
    assert.deepEqual(row.stagedLineCounts, { addedLineCount: 1, removedLineCount: 1 })
    assert.deepEqual(row.unstagedLineCounts, { addedLineCount: 1, removedLineCount: 1 })
    assert.equal(row.newContent, '')
    await git('reset', '--quiet')
    await writeFile(path.join(root, 'cancel.txt'), 'only unstaged\n')
    const unstagedOnly = (await getGitDiffSnapshot(root, { includeContent: false })).fileDiffs[0]
    assert.deepEqual(unstagedOnly.stagedLineCounts, { addedLineCount: 0, removedLineCount: 0 })
    assert.deepEqual(unstagedOnly.unstagedLineCounts, { addedLineCount: 1, removedLineCount: 1 })

  } finally {
    assert.equal(path.dirname(root), os.tmpdir())
    await rm(root, { recursive: true, force: true })
  }
})

test('conflict metadata counts match its HEAD-to-worktree preview without an index blob', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tidecode-diff-stats-'))
  const git = (...args: string[]) => execFileAsync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, windowsHide: true })
  try {
    await git('init', '--quiet')
    await writeFile(path.join(root, 'conflict.txt'), 'original\n')
    await git('add', '.')
    await git('commit', '--quiet', '-m', 'Fixture')
    await git('checkout', '-b', 'other')
    await writeFile(path.join(root, 'conflict.txt'), 'other\n')
    await git('commit', '-am', 'Other', '--quiet')
    await git('checkout', '-b', 'ours', 'HEAD~1')
    await writeFile(path.join(root, 'conflict.txt'), 'ours\n')
    await git('commit', '-am', 'Ours', '--quiet')
    await assert.rejects(git('merge', 'other'))
    const snapshot = await getGitDiffSnapshot(root, { includeContent: false })
    const row = snapshot.fileDiffs[0]
    assert.equal(row.changeStatus, 'conflicted')
    assert.deepEqual(row.unstagedLineCounts, { addedLineCount: row.addedLineCount, removedLineCount: row.removedLineCount })
    assert.ok((row.addedLineCount ?? 0) > 0)
    assert.equal(row.indexContent, null)
    assert.equal(row.newContent, '')
  } finally {
    assert.equal(path.dirname(root), os.tmpdir())
    await rm(root, { recursive: true, force: true })
  }
})
