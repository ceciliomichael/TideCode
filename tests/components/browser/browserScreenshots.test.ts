import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  access,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  resolveBrowserScreenshot,
  saveBrowserScreenshot,
} from '../../../electron/browser/screenshots'

test('browser screenshots create the project folder with unique hostname/timestamp/random filenames', async (t) => {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), 'tidecode-browser-save-'),
  )
  t.after(() => rm(projectPath, { recursive: true, force: true }))
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
  assert.match(
    path.basename(first.filePath),
    /^browser-screenshot-www-google-com-[a-z0-9]+-[a-f0-9]{8}\.png$/,
  )
  assert.equal(
    path.dirname(first.filePath),
    path.join(first.projectPath, '.tidecode', 'browser-screenshots'),
  )
  assert.notEqual(first.filePath, second.filePath)
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

test('browser screenshots reject missing projects, non-directories, and redirected screenshot folders', async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'tidecode-browser-paths-'),
  )
  const outside = await mkdtemp(
    path.join(tmpdir(), 'tidecode-browser-outside-'),
  )
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
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
  await symlink(
    outside,
    path.join(directory, '.tidecode'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await assert.rejects(
    () => saveBrowserScreenshot(directory, 'https://example.com', png),
    /stay inside the project/,
  )
  await assert.rejects(
    () => access(path.join(outside, 'browser-screenshots')),
    /ENOENT/,
  )
})
