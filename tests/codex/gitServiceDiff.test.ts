import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { getGitDiffSnapshot } from '../../electron/git/serviceDiff'

const execFileAsync = promisify(execFile)

test('full Git diff snapshots retain binary untracked files from status snapshots', async () => {
  const repoPath = await mkdtemp(path.join(tmpdir(), 'tidecode-git-diff-'))

  try {
    await execFileAsync('git', ['init'], { cwd: repoPath })
    await writeFile(path.join(repoPath, 'example.txt'), 'hello\n', 'utf8')
    await writeFile(path.join(repoPath, 'binary.bin'), Buffer.from([0, 1, 2, 3]))

    const statusSnapshot = await getGitDiffSnapshot(repoPath, { includeContent: false })
    const fullSnapshot = await getGitDiffSnapshot(repoPath, { includeContent: true })

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
