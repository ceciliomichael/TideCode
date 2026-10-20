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
import { getApiInstructions } from '../../electron/chat/shared/ai/registry/documentation'
import { listAgentBrowserTabs, requireBrowserUrl } from '../../electron/browser/agentTabs'
import { setRunServiceBrowserHandler } from '../../electron/runService/browserService'
import { formatBrowserElements } from '../../electron/browser/agentPageStructure'
import { scrubBrowserDiagnosticText } from '../../electron/browser/agentCdpSession'

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

test('six documented browser tools register in Agent Mode and remain unavailable in Plan Mode', async () => {
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
      for (const name of ['open', 'read', 'tabs', 'terminate', 'interact', 'devtools']) {
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
      assert.match(String(outcome.toolCalls.at(-1)?.body), /Page 1 \(10 per page, 0 tabs total\)/)
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

test('diagnostic output redacts URL parameters and common secrets', () => {
  const text = scrubBrowserDiagnosticText('https://example.test/api?token=secret authorization: Bearer secret123')
  assert.doesNotMatch(text, /secret123/)
  assert.doesNotMatch(text, /token=secret/)
  assert.match(text, /redacted/)
})
