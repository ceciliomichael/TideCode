import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleStartupBackgroundTask } from '../src/lib/startupBackgroundTask'

test('startup background tasks wait for both the startup delay and an idle callback', () => {
  const originalWindow = globalThis.window
  let timeoutCallback: (() => void) | null = null
  let idleCallback: (() => void) | null = null
  let taskRunCount = 0

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (callback: () => void) => {
        timeoutCallback = callback
        return 11
      },
      clearTimeout: () => undefined,
      requestIdleCallback: (callback: () => void) => {
        idleCallback = callback
        return 22
      },
      cancelIdleCallback: () => undefined,
    },
  })

  try {
    scheduleStartupBackgroundTask(() => {
      taskRunCount += 1
    })

    assert.equal(taskRunCount, 0)
    assert.ok(timeoutCallback)
    timeoutCallback()
    assert.equal(taskRunCount, 0)
    assert.ok(idleCallback)
    idleCallback()
    assert.equal(taskRunCount, 1)
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  }
})

test('cancelling a startup background task prevents delayed work', () => {
  const originalWindow = globalThis.window
  let timeoutCallback: (() => void) | null = null
  let taskRunCount = 0
  let clearTimeoutCount = 0

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      setTimeout: (callback: () => void) => {
        timeoutCallback = callback
        return 33
      },
      clearTimeout: () => {
        clearTimeoutCount += 1
      },
    },
  })

  try {
    const cancel = scheduleStartupBackgroundTask(() => {
      taskRunCount += 1
    })
    cancel()
    assert.equal(clearTimeoutCount, 1)
    assert.ok(timeoutCallback)
    timeoutCallback()
    assert.equal(taskRunCount, 0)
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
    }
  }
})
