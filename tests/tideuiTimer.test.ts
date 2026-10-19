import assert from 'node:assert/strict'
import test from 'node:test'
import {
  changeTideTimerDuration,
  createTideTimer,
  tideTimerRemainingSeconds,
  transitionTideTimer,
} from '../src/lib/tideui/timer'

test('50 minute timer starts once, runs on absolute deadline and pauses/resumes', () => {
  const startTime = 10_000
  const idle = createTideTimer(50)
  const running = transitionTideTimer(idle, 'start', startTime)
  assert.equal(running.status, 'running')
  assert.equal(running.deadlineMs, startTime + 3_000_000)
  assert.equal(transitionTideTimer(running, 'start', startTime + 100), running)
  assert.equal(tideTimerRemainingSeconds(running, startTime + 30_000), 2970)

  const paused = transitionTideTimer(running, 'pause', startTime + 30_000)
  assert.equal(paused.status, 'paused')
  assert.equal(tideTimerRemainingSeconds(paused, startTime + 600_000), 2970)
  const resumed = transitionTideTimer(paused, 'resume', startTime + 600_000)
  assert.equal(resumed.deadlineMs, startTime + 600_000 + 2_970_000)
  assert.equal(tideTimerRemainingSeconds(resumed, startTime + 601_000), 2969)
})

test('background throttling cannot drift a timer or miss the completion state', () => {
  const running = transitionTideTimer(createTideTimer(25), 'start', 1000)
  const completion = transitionTideTimer(running, 'tick', 1_504_000)
  assert.equal(completion.status, 'completed')
  assert.equal(tideTimerRemainingSeconds(completion, 9_000_000), 0)
  assert.equal(transitionTideTimer(completion, 'tick', 9_100_000), completion)
})

test('reset/end/restart are reliable and duration changes are blocked while active', () => {
  const idle = createTideTimer(90)
  const changed = changeTideTimerDuration(idle, 50)
  assert.equal(changed.durationMinutes, 50)
  assert.equal(changeTideTimerDuration(changed, 0), changed)
  assert.equal(changeTideTimerDuration(changed, 241), changed)

  const running = transitionTideTimer(changed, 'start', 2_000)
  assert.equal(changeTideTimerDuration(running, 90), running)
  const ended = transitionTideTimer(running, 'end', 3_000)
  assert.equal(ended.status, 'ended')
  assert.equal(ended.deadlineMs, null)
  const restarted = transitionTideTimer(ended, 'start', 5_000)
  assert.equal(restarted.remainingMs, 50 * 60_000)
  const reset = transitionTideTimer(restarted, 'reset', 6_000)
  assert.deepEqual(reset, changed)
  assert.equal(transitionTideTimer(reset, 'pause', 7_000), reset)
  assert.equal(transitionTideTimer(reset, 'resume', 7_000), reset)
})
