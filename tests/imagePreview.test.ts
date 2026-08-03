import assert from 'node:assert/strict'
import test from 'node:test'
import { createDocxPreviewDataUrl, isDocxPreviewablePath } from '../src/lib/docx-preview'
import {
  createImagePreviewDataUrl,
  getImagePreviewMimeType,
  isImagePreviewablePath,
} from '../src/lib/image-preview'
import { createPdfPreviewDataUrl, isPdfPreviewablePath } from '../src/lib/pdf-preview'

test('image preview routing recognizes browser-supported workspace image formats', () => {
  assert.equal(getImagePreviewMimeType('assets/photo.PNG'), 'image/png')
  assert.equal(getImagePreviewMimeType('assets/bitmap.bmp'), 'image/bmp')
  assert.equal(getImagePreviewMimeType('assets/photo.jpeg'), 'image/jpeg')
  assert.equal(getImagePreviewMimeType('assets/animation.gif'), 'image/gif')
  assert.equal(getImagePreviewMimeType('assets/photo.webp'), 'image/webp')
  assert.equal(getImagePreviewMimeType('assets/icon.ico'), 'image/x-icon')
  assert.equal(getImagePreviewMimeType('assets/animated.apng'), 'image/apng')
  assert.equal(getImagePreviewMimeType('assets/notes.txt'), null)
  assert.equal(isImagePreviewablePath('assets/photo.avif'), true)
  assert.equal(isImagePreviewablePath('assets/diagram.svg'), false)
})

test('image preview data URLs preserve the MIME type and base64 payload', () => {
  assert.equal(createImagePreviewDataUrl('image/png', 'iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
})

test('PDF preview routing accepts PDF files and preserves their data URL MIME type', () => {
  assert.equal(isPdfPreviewablePath('docs/report.PDF'), true)
  assert.equal(isPdfPreviewablePath('docs/report.txt'), false)
  assert.equal(createPdfPreviewDataUrl('JVBERi0xLjQ='), 'data:application/pdf;base64,JVBERi0xLjQ=')
})

test('DOCX preview routing accepts DOCX files and preserves their data URL MIME type', () => {
  assert.equal(isDocxPreviewablePath('docs/report.DOCX'), true)
  assert.equal(isDocxPreviewablePath('docs/report.doc'), false)
  assert.equal(createDocxPreviewDataUrl('UEsDBA=='), 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==')
})
