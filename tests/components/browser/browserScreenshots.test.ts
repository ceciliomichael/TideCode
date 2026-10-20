import assert from 'node:assert/strict'
import {
  mkdtemp,
  realpath,
  readFile,
  rm,
  writeFile,
  access,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  resolveBrowserScreenshot,
  saveBrowserScreenshot,
} from '../../../electron/browser/screenshots'

test('browser screenshots save in the user folder with unique hostname/timestamp/random filenames', async (t) => {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), 'tidecode-browser-save-'),
  )
  const savedPaths: string[] = []
  t.after(async () => {
    await Promise.all(savedPaths.map((filePath) => rm(filePath, { force: true })))
    await rm(projectPath, { recursive: true, force: true })
  })
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const first = await saveBrowserScreenshot(
    projectPath,
    'https://www.google.com/search?private=query',
    png,
  )
  const second = await saveBrowserScreenshot(
    projectPath,
    'https://www.google.com/',
    png,
  )
  savedPaths.push(first.filePath, second.filePath)
  assert.match(
    path.basename(first.filePath),
    /^browser-screenshot-www-google-com-[a-z0-9]+-[a-f0-9]{8}\.png$/,
  )
  assert.equal(
    path.dirname(first.filePath),
    path.join(await realpath(homedir()), '.tidecode', 'browser-screenshots'),
  )
  assert.notEqual(first.filePath, second.filePath)
  await assert.rejects(
    () => access(path.join(projectPath, '.tidecode')),
    /ENOENT/,
  )
  assert.deepEqual(await readFile(first.filePath), png)
  assert.equal(await resolveBrowserScreenshot(first), first.filePath)
  await assert.rejects(
    () =>
      resolveBrowserScreenshot({
        ...first,
        filePath: path.join(projectPath, 'private.png'),
      }),
    /saved browser screenshot/,
  )
})

test('browser screenshots reject missing projects and non-directories', async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'tidecode-browser-paths-'),
  )
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const png = Buffer.from('png')
  await assert.rejects(
    () => saveBrowserScreenshot('__no-workspace__', 'https://example.com', png),
    /Open a project/,
  )
  const file = path.join(directory, 'file')
  await writeFile(file, 'not a directory')
  await assert.rejects(
    () => saveBrowserScreenshot(file, 'https://example.com', png),
    /must be a directory/,
  )
  await assert.rejects(
    () => access(path.join(directory, '.tidecode')),
    /ENOENT/,
  )
})
