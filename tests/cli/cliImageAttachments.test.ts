import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  extractPastedImageFilePaths,
  formatCliImageReference,
  formatCliImageReferenceInText,
  getImageMimeType,
  isImageExtension,
  normalizeFilePath,
  readCliImageAttachment,
  readCliImageAttachmentSync,
} from '../../electron/cli/cliImageAttachments'

test('isImageExtension identifies supported image extensions', () => {
  assert.equal(isImageExtension('test.png'), true)
  assert.equal(isImageExtension('photo.jpg'), true)
  assert.equal(isImageExtension('graphic.jpeg'), true)
  assert.equal(isImageExtension('icon.webp'), true)
  assert.equal(isImageExtension('anim.gif'), true)
  assert.equal(isImageExtension('vector.svg'), true)
  assert.equal(isImageExtension('camera.heic'), true)
  assert.equal(isImageExtension('document.pdf'), false)
  assert.equal(isImageExtension('script.js'), false)
})

test('getImageMimeType returns correct MIME types', () => {
  assert.equal(getImageMimeType('test.png'), 'image/png')
  assert.equal(getImageMimeType('photo.jpg'), 'image/jpeg')
  assert.equal(getImageMimeType('photo.jpeg'), 'image/jpeg')
  assert.equal(getImageMimeType('icon.webp'), 'image/webp')
  assert.equal(getImageMimeType('anim.gif'), 'image/gif')
  assert.equal(getImageMimeType('vector.svg'), 'image/svg+xml')
})

test('normalizeFilePath handles quoted and relative paths', () => {
  const normalized = normalizeFilePath('"C:\\images\\pic.png"')
  assert.ok(normalized.includes('pic.png'))

  const relative = normalizeFilePath('subfolder/img.png', '/workspace/root')
  assert.ok(relative.includes('img.png'))
})

test('extractPastedImageFilePaths extracts image file paths from pasted text', () => {
  const single = extractPastedImageFilePaths('C:\\Users\\User\\Pictures\\screenshot.png')
  assert.equal(single.length, 1)
  assert.ok(single[0].endsWith('screenshot.png'))

  const multiple = extractPastedImageFilePaths('"pic1.png"\n"pic2.jpg"', '/workspace')
  assert.equal(multiple.length, 2)

  const nonImage = extractPastedImageFilePaths('just normal prompt text without files')
  assert.equal(nonImage.length, 0)
})

import { stripAnsi } from '../../electron/cli/renderer'

test('formatCliImageReference produces styled ANSI reference tag without extra padding spaces', () => {
  const formatted = formatCliImageReference(1)
  assert.equal(stripAnsi(formatted), '[Image #1]')

  const inText = formatCliImageReferenceInText('Please inspect [Image #1] and [Image #2] for UI bugs.')
  assert.equal(stripAnsi(inText), 'Please inspect [Image #1] and [Image #2] for UI bugs.')
})

test('readCliImageAttachment reads image files as ChatImageAttachment', async () => {
  const tempDir = path.join(os.tmpdir(), `tidecode-test-images-${Date.now()}`)
  await mkdir(tempDir, { recursive: true })
  const testImagePath = path.join(tempDir, 'test-sample.png')
  const dummyPngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  await writeFile(testImagePath, dummyPngBytes)

  try {
    const asyncResult = await readCliImageAttachment(testImagePath)
    assert.ok(asyncResult)
    assert.equal(asyncResult?.kind, 'image')
    assert.equal(asyncResult?.fileName, 'test-sample.png')
    assert.equal(asyncResult?.mimeType, 'image/png')
    assert.ok(asyncResult?.dataUrl.startsWith('data:image/png;base64,'))

    const syncResult = readCliImageAttachmentSync(testImagePath)
    assert.ok(syncResult)
    assert.equal(syncResult?.kind, 'image')
    assert.equal(syncResult?.fileName, 'test-sample.png')
    assert.equal(syncResult?.mimeType, 'image/png')
    assert.ok(syncResult?.dataUrl.startsWith('data:image/png;base64,'))
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
})
