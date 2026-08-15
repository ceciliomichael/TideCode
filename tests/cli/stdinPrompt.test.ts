import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  readPipedPrompt,
  resolveHeadlessPrompt,
  type CliInputStream,
} from '../../electron/cli/stdinPrompt'

function createInput(isTTY: boolean): PassThrough & { isTTY: boolean } {
  const input = new PassThrough() as PassThrough & { isTTY: boolean }
  input.isTTY = isTTY
  return input
}

test('TTY stdin always selects interactive mode', async () => {
  const input = createInput(true)
  input.end('ignored')

  assert.equal(await readPipedPrompt(input), null)
})

test('non-TTY stdin without readable data selects interactive mode', async () => {
  const input = createInput(false)

  assert.equal(await readPipedPrompt(input, 5), null)
  input.destroy()
})

test('non-TTY stdin with real data returns a normalized piped prompt', async () => {
  const input = createInput(false)
  input.end('  inspect this workspace\r\n')

  assert.equal(await readPipedPrompt(input as CliInputStream), 'inspect this workspace')
})

test('an empty pipe does not create an empty headless turn', async () => {
  const input = createInput(false)
  input.end(' \r\n\t ')

  assert.equal(await readPipedPrompt(input), null)
})

test('an explicit prompt wins over piped input and blank input resolves to interactive mode', () => {
  assert.equal(resolveHeadlessPrompt('  explicit prompt  ', 'piped prompt'), 'explicit prompt')
  assert.equal(resolveHeadlessPrompt(undefined, 'piped prompt'), 'piped prompt')
  assert.equal(resolveHeadlessPrompt('   ', null), null)
})
