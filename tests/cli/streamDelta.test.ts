import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalStreamAccumulator } from '../../electron/cli/streamDelta'

test('stream accumulator preserves normal suffix deltas', () => {
  const accumulator = new TerminalStreamAccumulator()

  assert.equal(accumulator.append('Hello'), 'Hello')
  assert.equal(accumulator.append(' world'), ' world')
  assert.equal(accumulator.text, 'Hello world')
})

test('stream accumulator converts cumulative snapshots into suffix deltas', () => {
  const accumulator = new TerminalStreamAccumulator()

  assert.equal(accumulator.append('The app'), 'The app')
  assert.equal(accumulator.append('The app is TideCode'), ' is TideCode')
  assert.equal(accumulator.append('The app is TideCode'), '')
  assert.equal(accumulator.text, 'The app is TideCode')
})

test('stream accumulator ignores an old snapshot after a newer one', () => {
  const accumulator = new TerminalStreamAccumulator()

  accumulator.append('first sentence')
  accumulator.append('first sentence and more')

  assert.equal(accumulator.append('first sentence'), '')
  assert.equal(accumulator.text, 'first sentence and more')
})

test('stream accumulator keeps legitimate repeated words in normal deltas', () => {
  const accumulator = new TerminalStreamAccumulator()

  accumulator.append('hello')
  accumulator.append(' hello')

  assert.equal(accumulator.text, 'hello hello')
})
