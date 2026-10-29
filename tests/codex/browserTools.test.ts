import '../configureAppRoot'
import assert from 'node:assert/strict'
import { normalizeBrowserKey } from '../../electron/browser/agentPageInput'

test('browser key parser accepts case-insensitive key names and modifiers', () => {
  assert.equal(normalizeBrowserKey('ENTER'), 'Enter')
  assert.equal(normalizeBrowserKey('enter'), 'Enter')
  assert.equal(normalizeBrowserKey('ctrl+shift+enter'), 'Ctrl+Shift+Enter')
  assert.equal(normalizeBrowserKey('ESC'), 'Escape')
  assert.equal(normalizeBrowserKey('arrowdown'), 'ArrowDown')
  assert.equal(normalizeBrowserKey('unknown-key'), 'unknown-key')
})
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAgentToolBundle } from '../../electron/chat/shared/tools/factory'
import { createBrowserToolSet } from '../../electron/chat/shared/tools/browserTools'
import { asSchema } from '@ai-sdk/provider-utils'
import { getApiInstructions } from '../../electron/chat/shared/ai/registry/documentation'
import { listAgentBrowserTabs, requireBrowserUrl } from '../../electron/browser/agentTabs'
import { setRunServiceBrowserHandler } from '../../electron/runService/browserService'
import { formatBrowserElements } from '../../electron/browser/agentPageStructure'
import { scrubBrowserDiagnosticText } from '../../electron/browser/agentCdpSession'
import { DEFAULT_AGENT_VIEWPORT, getAgentViewport, rememberAgentViewport, resolveAgentViewport } from '../../electron/browser/agentViewport'
import type { WebContents } from 'electron'

test('browser viewport defaults, dimension validation and per-tab ownership are explicit', () => {
  assert.deepEqual(resolveAgentViewport(), { width: 1440, height: 900 })
  assert.deepEqual(resolveAgentViewport({ width: 390 }), { width: 390, height: 900 })
  assert.deepEqual(resolveAgentViewport({ height: 844 }), { width: 1440, height: 844 })
  for (const value of [0, -1, 4097, 1.5, NaN, Infinity, '390', null]) {
    assert.throws(() => resolveAgentViewport({ width: value }), /viewport width/)
    assert.throws(() => resolveAgentViewport({ height: value }), /viewport height/)
  }
  const phone = {} as WebContents
  const desktop = {} as WebContents
  rememberAgentViewport(phone, { width: 390, height: 844 })
  assert.deepEqual(getAgentViewport(phone), { width: 390, height: 844 })
  assert.deepEqual(getAgentViewport(desktop), DEFAULT_AGENT_VIEWPORT)
})

test('browser.read never sends dimensions and always uses the existing viewport', async () => {
  const requests: Array<{ operation: string; width?: number; height?: number }> = []
  setRunServiceBrowserHandler(async (request) => {
    requests.push(request)
    const viewport = resolveAgentViewport(request)
    return { data: { ...viewport, body: 'Viewport checked' } }
  })
  try {
    const read = createBrowserToolSet({ workspaceRootPath: 'C:/viewport-test' })['browser.read']
    await read.execute!({ tab_id: 'same-tab', view: 'structure' }, {} as never)
    const mobile = await read.execute!({ tab_id: 'same-tab', view: 'visual' }, {} as never)
    assert.equal(requests[0].width, undefined)
    assert.equal(requests[0].height, undefined)
    assert.equal(requests[1].width, undefined)
    assert.equal(requests[1].height, undefined)
    assert.deepEqual(mobile.semantics, { tab_id: 'same-tab', width: 1440, height: 900 })
    assert.equal(requests.length, 2)
    const instructions = getApiInstructions('browser.read')
    assert.match(instructions, /never resizes the tab/)
    const schema = (read.inputSchema as { jsonSchema?: { properties?: Record<string, unknown> } }).jsonSchema
    assert.equal(schema?.properties?.width, undefined)
    assert.equal(schema?.properties?.height, undefined)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('browser URL policy permits HTTP(S), localhost and rejects privileged protocols and embedded credentials', () => {
  assert.equal(requireBrowserUrl('https://example.com/path'), 'https://example.com/path')
  assert.equal(requireBrowserUrl('http://localhost:8000/'), 'http://localhost:8000/')
  for (const unsafe of [
    'file:///C:/secret.txt',
    'javascript:alert(1)',
    'data:text/html,hello',
    'chrome://settings',
    'https://name:password@example.com/',
    'example.com',
  ]) {
    assert.throws(() => requireBrowserUrl(unsafe), unsafe)
  }
})

test('browser tab listing uses 10-entry pages and validates page numbers', () => {
  const project = path.join(tmpdir(), 'browser-list-empty-project')
  assert.deepEqual(listAgentBrowserTabs(project, 1), {
    page: 1,
    page_size: 10,
    total: 0,
    has_more: false,
    tabs: [],
  })
  assert.equal(listAgentBrowserTabs(project, 2).tabs.length, 0)
  for (const page of [0, -1, 1.5, NaN]) {
    assert.throws(() => listAgentBrowserTabs(project, page), /positive integer/)
  }
})

test('seven documented browser tools register in Agent Mode and remain unavailable in Plan Mode', async () => {
  const workspaceRootPath = await mkdtemp(path.join(tmpdir(), 'tidecode-browser-tools-'))
  setRunServiceBrowserHandler(async (request) => {
    assert.equal(request.projectPath, workspaceRootPath)
    if (request.operation !== 'tabs') throw new Error('Unexpected browser operation.')
    return { data: { page: request.page, total: 0, has_more: false, tabs: [] } }
  })

  try {
    const agent = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
    const plan = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
    try {
      for (const name of ['open', 'navigate', 'read', 'tabs', 'terminate', 'interact', 'devtools']) {
        const fullName = 'browser.' + name
        const definition = agent.registry.get(fullName)
        assert.ok(definition, fullName)
        assert.equal(definition.namespace, 'native_browser')
        assert.match(getApiInstructions(fullName), new RegExp('tools\\.browser\\.' + name))
        assert.equal(plan.registry.get(fullName), undefined)
      }
      const script = [
        'await tools.available.get({ name: "tools.browser.tabs" });',
        'return await tools.browser.tabs({ page: 1 });',
      ].join('\n')
      const outcome = await agent.codeModeExecutor.run(script)
      assert.equal(outcome.status, 'success', outcome.error)
      assert.equal(outcome.toolCalls.at(-1)?.name, 'browser.tabs')
      assert.match(String(outcome.toolCalls.at(-1)?.body), /Browser tabs: page 1, 0 total/)
      const invalid = await agent.codeModeExecutor.run('return await tools.browser.tabs({ page: 0 });')
      assert.equal(invalid.status, 'error')
    } finally {
      await agent.codeModeExecutor.dispose()
      await plan.codeModeExecutor.dispose()
    }
  } finally {
    setRunServiceBrowserHandler(null)
    await rm(workspaceRootPath, { recursive: true, force: true })
  }
})

test('browser.tabs explicitly identifies AI-owned and user-owned tabs', async () => {
  setRunServiceBrowserHandler(async () => ({
    data: {
      page: 1,
      total: 2,
      has_more: false,
      tabs: [
        { tab_id: 'agent-tab', kind: 'agent', title: 'Agent Page', url: 'https://example.com/' },
        { tab_id: 'user-tab', kind: 'visible', title: 'User Page', url: 'https://example.org/' },
      ],
    },
  }))
  try {
    const tool = createBrowserToolSet({ workspaceRootPath: 'C:/browser-owner-test' })['browser.tabs']
    const result = await tool.execute!({ page: 1 }, {} as never)
    assert.match(result.body ?? '', /Agent Page\n {3}Ownership: AI-owned/u)
    assert.match(result.body ?? '', /User Page\n {3}Ownership: User-owned/u)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})
test('Node-only browser tools report a missing desktop host rather than accessing Electron globals', async () => {
  const workspaceRootPath = await mkdtemp(path.join(tmpdir(), 'tidecode-browser-no-host-'))
  try {
    const agent = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
    try {
      const outcome = await agent.codeModeExecutor.run([
        'await tools.available.get({ name: "tools.browser.open" });',
        'return await tools.browser.open({ url: "https://example.com/" });',
      ].join('\n'))
      assert.equal(outcome.status, 'error')
      assert.match(String(outcome.error), /desktop browser host/i)
      assert.doesNotMatch(String(outcome.error), /fromId/)
    } finally {
      await agent.codeModeExecutor.dispose()
    }
  } finally {
    await rm(workspaceRootPath, { recursive: true, force: true })
  }
})

test('structure formatter gives scoped element references and pagination', () => {
  const text = formatBrowserElements([{
    ref: 'el-abc-42', role: 'button', tag: 'BUTTON', name: 'Save profile',
    x: 140, y: 60,
  }], 21, 10)
  assert.match(text, /el-abc-42/)
  assert.match(text, /Save profile/)
  assert.match(text, /Elements 11-11 of 21/)
})

test('read observes the existing tab without URL input and non-navigation interactions do not request navigation', async () => {
  const requests: Array<{ operation: string; [key: string]: unknown }> = []
  setRunServiceBrowserHandler(async (request) => {
    requests.push(request)
    return { data: { action: 'click', url: 'http://localhost/current', title: 'Current page', loading: false, body: 'Current state', width: 1280, height: 720 } }
  })
  try {
    const tools = createBrowserToolSet({ workspaceRootPath: 'C:/browser-contract-test' })
    const readSchema = asSchema(tools['browser.read'].inputSchema).jsonSchema as { required: string[]; properties: Record<string, unknown> }
    assert.deepEqual(readSchema.required, ['tab_id'])
    assert.ok(!('url' in readSchema.properties))
    await tools['browser.read'].execute!({ tab_id: 'existing-tab', view: 'structure' }, {} as never)
    const interaction = await tools['browser.interact'].execute!(
      { tab_id: 'existing-tab', action: 'click', element_ref: 'el-current' }, {} as never,
    )
    assert.match(interaction.body ?? '', /Viewport: 1280 × 720/)
    assert.deepEqual(interaction.semantics, { tab_id: 'existing-tab', width: 1280, height: 720 })
    assert.deepEqual(requests.map((request) => request.operation), ['read', 'interact'])
    assert.equal(requests[0].tabId, 'existing-tab')
    assert.ok(!('url' in requests[0]))
    assert.deepEqual(requests[1].action, { action: 'click', element_ref: 'el-current' })
    assert.equal(requests[1].tabId, 'existing-tab')
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('browser clicks accept either element references or coordinates and reject ambiguous targets', async () => {
  const requests: unknown[] = []
  setRunServiceBrowserHandler(async (request) => {
    requests.push(request)
    return { data: { action: 'click', url: 'http://localhost/', loading: false } }
  })
  try {
    const interact = createBrowserToolSet({ workspaceRootPath: 'C:/browser-reference-test' })['browser.interact']
    for (const input of [
      { action: 'click' },
      { action: 'click', element_ref: ' ' },
      { action: 'click', x: 10 },
      { action: 'click', element_ref: 'el-current', x: 10, y: 20 },
    ]) {
      const result = await interact.execute!({ tab_id: 'existing-tab', ...input }, {} as never)
      assert.equal(result.status, 'error')
      assert.match(result.body ?? '', /(?:either an element_ref or x and y viewport coordinates|observation_id)/u)
    }
    assert.equal(requests.length, 0, 'rejected clicks never reach the desktop')
    await interact.execute!({ tab_id: 'existing-tab', action: 'click', element_ref: 'el-current' }, {} as never)
    await interact.execute!({ tab_id: 'existing-tab', action: 'click', x: 10, y: 20, observation_id: 'observed-frame' }, {} as never)
    await interact.execute!({ tab_id: 'existing-tab', action: 'hover', x: 12, y: 22, observation_id: 'observed-frame' }, {} as never)
    await interact.execute!({ tab_id: 'existing-tab', action: 'scroll', x: 10, y: 20, delta_y: 200 }, {} as never)
    assert.equal(requests.length, 4)
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('diagnostic output redacts URL parameters and common secrets', () => {
  const text = scrubBrowserDiagnosticText('https://example.test/api?token=secret authorization: Bearer secret123')
  assert.doesNotMatch(text, /secret123/)
  assert.doesNotMatch(text, /token=secret/)
  assert.match(text, /redacted/)
})

test('browser.interact sequences make one host call and deliver each labeled image even after a later failure', async () => {
  const requests: unknown[] = []
  const outputs: import('@ai-sdk/provider-utils').ToolResultOutput[] = []
  setRunServiceBrowserHandler(async (request) => {
    requests.push(request)
    assert.equal(request.operation, 'sequence')
    return {
      data: { completed_steps: 3, failed_step: 4, error: 'Target detached', elapsed_ms: 120 },
      captures: [
        { step: 1, label: 'Before', started_ms: 0, completed_ms: 12, body: 'Starting state', imageBase64: Buffer.from('before-png').toString('base64') },
        { step: 3, label: 'During', started_ms: 100, completed_ms: 115, body: 'Airborne', imageBase64: Buffer.from('during-png').toString('base64') },
      ],
    }
  })
  try {
    const interact = createBrowserToolSet({
      workspaceRootPath: 'C:/sequence-test', captureModelOutput: (output) => outputs.push(output),
    })['browser.interact']
    const steps = [
      { action: 'read', view: 'visual', label: 'Before' },
      { action: 'key', key: 'Space' },
      { action: 'read', view: 'visual', label: 'During' },
      { action: 'click', element_ref: 'el-detached' },
    ]
    const result = await interact.execute!({ tab_id: 'game', steps }, {} as never)
    assert.equal(requests.length, 1)
    assert.equal(result.status, 'error')
    assert.match(result.body!, /Completed: 3\/4/)
    assert.match(result.body!, /Stopped at step 4: Target detached/)
    assert.match(result.body!, /Airborne/)
    assert.equal(outputs.length, 1)
    const output = outputs[0]
    assert.equal(output.type, 'content')
    if (output.type !== 'content') {
      throw new Error('Expected image content')
    }
    const files = output.value.filter((item) => item.type === 'file')
    assert.equal(files.length, 2)
    assert.equal(files[0].filename, 'browser-game-step-1.png')
    assert.equal(files[1].filename, 'browser-game-step-3.png')
    assert.deepEqual(files[1].data, { type: 'data', data: Buffer.from('during-png') })
    const labels = output.value.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
    assert.match(labels, /Before \(step 1, 0–12ms\)/)
    assert.match(labels, /During \(step 3, 100–115ms\)/)
    for (const invalid of [
      { tab_id: 'game', action: 'key', key: 'Space', steps },
      { tab_id: 'game', steps: [{ action: 'key', key: 'Space' }, { action: 'click' }] },
    ]) {
      const rejected = await interact.execute!(invalid, {} as never)
      assert.equal(rejected.status, 'error')
    }
    assert.equal(requests.length, 1, 'invalid chains never reach the browser host')
  } finally {
    setRunServiceBrowserHandler(null)
  }
})

test('Code Mode discovers and validates the sequence contract and executes it through the registered browser tool', async () => {
  const workspaceRootPath = await mkdtemp(path.join(tmpdir(), 'tidecode-browser-sequence-'))
  let requests = 0
  const outputs: import('@ai-sdk/provider-utils').ToolResultOutput[] = []
  setRunServiceBrowserHandler(async (request) => {
    requests += 1
    assert.equal(request.operation, 'sequence')
    assert.equal(request.projectPath, workspaceRootPath)
    return {
      data: { completed_steps: 2, elapsed_ms: 30, width: 1440, height: 900 },
      captures: [{ step: 2, label: 'Jump', started_ms: 2, completed_ms: 30,
        body: 'Character is airborne', imageBase64: Buffer.from('jump-png').toString('base64') }],
    }
  })
  try {
    const bundle = await createAgentToolBundle({
      workspaceRootPath, captureModelOutput: (output) => outputs.push(output),
    }, { chatMode: 'agent' })
    try {
      const outcome = await bundle.codeModeExecutor.run([
        'await tools.available.get({ name: "tools.browser.interact" });',
        'return await tools.browser.interact({ tab_id: "game", steps: [',
        '  { action: "key", key: "Space" },',
        '  { action: "read", view: "visual", label: "Jump" }',
        '] });',
      ].join('\n'))
      assert.equal(outcome.status, 'success', outcome.error)
      assert.equal(outcome.toolCalls.at(-1)?.name, 'browser.interact')
      assert.match(outcome.toolCalls.at(-1)?.body ?? '', /Character is airborne/)
      assert.match(outcome.toolCalls.at(-1)?.body ?? '', /Viewport: 1440 × 900/)
      assert.equal(requests, 1)
      assert.equal(outputs.length, 1)
      for (const input of [
        { tab_id: 'game', steps: [] },
        { tab_id: 'game', action: 'key', key: 'Space', steps: [{ action: 'read' }] },
        { tab_id: 'game', steps: [{ action: 'wait', duration_ms: '100' }] },
      ]) {
        const invalid = await bundle.codeModeExecutor.run('return await tools.browser.interact(' + JSON.stringify(input) + ');')
        assert.equal(invalid.status, 'error')
      }
      assert.equal(requests, 1, 'invalid sequence contracts never dispatch a host request')
    } finally {
      await bundle.codeModeExecutor.dispose()
    }
  } finally {
    setRunServiceBrowserHandler(null)
    await rm(workspaceRootPath, { recursive: true, force: true })
  }
})
