import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  BracketedPasteDecoder,
} from '../../electron/cli/terminalBracketedPaste'

test('bracketed paste decoder keeps multiline content as one draft payload', () => {
  const decoder = new BracketedPasteDecoder()

  const firstChunk = decoder.consume(`${BRACKETED_PASTE_START}first line\r\n`)
  assert.deepEqual(firstChunk.pastedTexts, [])
  assert.equal(firstChunk.containsPasteSequence, true)
  assert.equal(decoder.isConsuming, true)

  const secondChunk = decoder.consume(`second line${BRACKETED_PASTE_END}`)
  assert.deepEqual(secondChunk.pastedTexts, ['first line\nsecond line'])
  assert.equal(decoder.isConsuming, false)
})

test('bracketed paste decoder handles split markers and multiple frames', () => {
  const decoder = new BracketedPasteDecoder()

  assert.equal(decoder.consume('\x1b[20').containsPasteSequence, true)
  const result = decoder.consume(`0~one${BRACKETED_PASTE_END}ignored${BRACKETED_PASTE_START}two${BRACKETED_PASTE_END}`)

  assert.deepEqual(result.pastedTexts, ['one', 'two'])
  assert.equal(decoder.isConsuming, false)
})
