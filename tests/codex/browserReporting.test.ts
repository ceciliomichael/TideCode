import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrowserToolSet } from '../../electron/chat/shared/tools/browserTools'
import { setRunServiceBrowserHandler, type BrowserHostRequest } from '../../electron/runService/browserService'

test('browser.open forwards the chosen viewport and reports it in plain text', async () => {
  let sent: BrowserHostRequest | undefined
  setRunServiceBrowserHandler(async (request) => {
    sent = request
    return { data: { tab_id: 'ai-1', url: 'https://example.test/', title: 'Example', status: 'loaded', width: 1920, height: 1080 } }
  })
  try {
    const open = createBrowserToolSet({ workspaceRootPath: 'C:/reporting-test' })['browser.open']
    const result = await open.execute!({ url: 'https://example.test/', width: 1920, height: 1080 }, {} as never)
    assert.equal(result.status, 'success')
    assert.equal(sent?.operation, 'open')
    if (sent?.operation !== 'open') throw new Error('Expected open operation')
    assert.equal(sent.width, 1920)
    assert.equal(sent.height, 1080)
    assert.match(result.body ?? '', /Viewport: 1920 × 1080/u)
    assert.match(result.body ?? '', /Tab: ai-1/u)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('browser.interact reports actual resolved coordinates without claiming page success', async () => {
  setRunServiceBrowserHandler(async () => ({
    data: {
      action: 'click', url: 'https://example.test/settings', loading: false,
      report: { action: 'click', target: 'Save changes', method: 'element_ref', x: 742.3, y: 410.7 },
    },
  }))
  try {
    const interact = createBrowserToolSet({ workspaceRootPath: 'C:/reporting-test' })['browser.interact']
    const result = await interact.execute!({ tab_id: 'ai-1', action: 'click', element_ref: 'el-save' }, {} as never)
    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /Target: Save changes/u)
    assert.match(result.body ?? '', /Method: element_ref/u)
    assert.match(result.body ?? '', /Coordinates: \(742\.3, 410\.7\)/u)
    assert.match(result.body ?? '', /Page outcome is not yet verified/u)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('browser sequences explain completed, failed and skipped steps in plain text', async () => {
  setRunServiceBrowserHandler(async () => ({
    data: {
      completed_steps: 1, failed_step: 2, elapsed_ms: 80,
      error: 'The button is no longer visible.',
      actions: [{ step: 1, status: 'completed', report: { action: 'click', target: 'Settings', method: 'coordinates', x: 200, y: 130 } }],
    },
  }))
  try {
    const interact = createBrowserToolSet({ workspaceRootPath: 'C:/reporting-test' })['browser.interact']
    const result = await interact.execute!({ tab_id: 'ai-1', steps: [
      { action: 'click', x: 200, y: 130, observation_id: 'obs-1' },
      { action: 'click', element_ref: 'el-hidden' },
      { action: 'key', key: 'Enter' },
    ] }, {} as never)
    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /1\. click: Settings\n   Coordinates: \(200, 130\) \| Method: coordinates \| Input dispatched/u)
    assert.match(result.body ?? '', /2\. click: el-hidden\n   Coordinates: N\/A \| Method: element_ref \| Failed/u)
    assert.match(result.body ?? '', /3\. key: key\n   Coordinates: N\/A \| Method: other \| Not executed/u)
    assert.match(result.body ?? '', /Earlier actions were not rolled back/u)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('browser diagnostics display plain text instead of raw JSON', async () => {
  setRunServiceBrowserHandler(async () => ({
    data: { output: { category: 'console', events: [{ time: 1793026800000, category: 'console', level: 'warning', message: 'Missing icon' }] } },
  }))
  try {
    const diagnostics = createBrowserToolSet({ workspaceRootPath: 'C:/reporting-test' })['browser.devtools']
    const result = await diagnostics.execute!({ tab_id: 'ai-1', action: 'console' }, {} as never)
    assert.equal(result.status, 'success')
    assert.match(result.body ?? '', /console \/ warning: Missing icon/u)
    assert.match(result.body ?? '', /Missing icon/u)
    assert.doesNotMatch(result.body ?? '', /"events"/u)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})
