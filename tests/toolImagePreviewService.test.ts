import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readToolImagePreview } from '../electron/chat/shared/tools/toolImagePreview'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
)

test('absolute images outside workspace are previewable', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-image-'))
  try {
    const file = path.join(directory, 'bullet-zoom.png')
    await fs.writeFile(file, PNG)
    assert.equal(await readToolImagePreview(file), `data:image/png;base64,${PNG.toString('base64')}`)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('tool image preview rejects relative, nonimage, oversized, and missing paths', async () => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-image-reject-'))
  try {
    const textFile = path.join(directory, 'fake.png')
    const oversized = path.join(directory, 'oversized.png')
    await fs.writeFile(textFile, 'not an image')
    await fs.writeFile(oversized, PNG)
    await fs.truncate(oversized, 32 * 1024 * 1024 + 1)

    assert.equal(await readToolImagePreview('relative.png'), null)
    assert.equal(await readToolImagePreview(textFile), null)
    assert.equal(await readToolImagePreview(oversized), null)
    assert.equal(await readToolImagePreview(path.join(directory, 'missing.png')), null)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
