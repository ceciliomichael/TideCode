import assert from 'node:assert/strict'
import test from 'node:test'
import { detectRawHtmlDocument } from '../src/lib/markdownCodeDetection'

test('detectRawHtmlDocument recognizes an unfenced streamed HTML document', () => {
  const result = detectRawHtmlDocument(
    'Final: Write it.\n\n<!\nDOCTYPE html>\n<html>\n<style>#cross { position: absolute; }</style>',
  )

  assert.deepEqual(result, {
    code: '<!\nDOCTYPE html>\n<html>\n<style>#cross { position: absolute; }</style>',
    language: 'html',
    prefix: 'Final: Write it.',
  })
})

test('detectRawHtmlDocument leaves already-fenced HTML alone', () => {
  assert.equal(
    detectRawHtmlDocument('```html\n<!DOCTYPE html>\n<html></html>\n```'),
    null,
  )
})

test('detectRawHtmlDocument ignores ordinary prose mentioning doctype', () => {
  assert.equal(detectRawHtmlDocument('Use <!DOCTYPE html> at the top of the file.'), null)
})
