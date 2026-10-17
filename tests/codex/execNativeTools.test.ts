import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { asSchema } from 'ai'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { getApiInstructions } from '../../electron/chat/shared/ai/registry/documentation'

async function withWorkspace(run: (workspaceRootPath: string) => Promise<void>) {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-exec-contract-'))
  try { await run(workspaceRootPath) }
  finally { await fs.rm(workspaceRootPath, { recursive: true, force: true }) }
}

async function execute(bundle: Awaited<ReturnType<typeof createAgentToolBundle>>, code: string, payloads?: Record<string, string>) {
  const api = bundle.tools.exec as { execute: (input: unknown, options: unknown) => Promise<unknown> }
  return api.execute({ code, ...(payloads ? { payloads } : {}) }, {
    context: {}, messages: [], toolCallId: 'exec-test', abortSignal: undefined,
  }) as Promise<{ status: string; body?: string; semantics?: { tool_calls?: Array<{ name: string; status: string }> } }>
}

test('only exec is TideCode provider-facing and native APIs have exact paths', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent', providerId: 'custom:test-provider' })
  assert.deepEqual(Object.keys(bundle.tools), ['exec'])
  for (const name of ['read', 'list', 'glob', 'grep', 'terminal.execute', 'terminal.read', 'terminal.interact', 'terminal.terminate', 'patch', 'write']) {
    assert.ok(bundle.registry.get(name), name)
    assert.ok(getApiInstructions(name).length > 0)
  }
  for (const obsolete of ['execute_terminal', 'apply_patch', 'edit', 'plan_create', 'skill', 'mcp_tool_search']) {
    assert.equal(bundle.registry.get(obsolete), undefined)
  }
  await bundle.codeModeExecutor.dispose()
}))

test('provider-facing exec schema does not use unsupported propertyNames and validates payload keys at runtime', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const schema = await asSchema(bundle.tools.exec.inputSchema).jsonSchema
  assert.doesNotMatch(JSON.stringify(schema), /"propertyNames"/u)
  const result = await execute(bundle, 'return 1;', { ['x'.repeat(129)]: 'invalid key' })
  assert.equal(result.status, 'error')
  assert.match(result.body ?? '', /between 1 and 128 characters/u)
  await bundle.codeModeExecutor.dispose()
}))

test('exec orchestrates nested tools and discovers exact callable paths', async () => withWorkspace(async (workspaceRootPath) => {
  await fs.writeFile(path.join(workspaceRootPath, 'sample.txt'), 'actual file contents\n')
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const result = await execute(bundle, [
    'const found = await tools.available.search({ query: "terminal execute" });',
    'const file = await tools.read({ path: "sample.txt" });',
    'return { found: found.items.map(x => x.path), file: file.body };',
  ].join('\n'))
  assert.equal(result.status, 'success', result.body)
  assert.match(result.body ?? '', /tools\.terminal\.execute/u)
  assert.match(result.body ?? '', /actual file contents/u)
  await bundle.codeModeExecutor.dispose()
}))

test('unsupported native API names and unknown parameters fail instead of falling back', async () => withWorkspace(async (workspaceRootPath) => {
  await fs.writeFile(path.join(workspaceRootPath, 'sample.txt'), 'contents\n')
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const obsolete = await execute(bundle, 'return await tools.execute_terminal({ command: "echo invalid" });')
  assert.equal(obsolete.status, 'error')
  assert.match(obsolete.body ?? '', /UnknownTool/u)
  const extra = await execute(bundle, 'return await tools.read({ path: "sample.txt", invented: true });')
  assert.equal(extra.status, 'error')
  assert.match(extra.body ?? '', /Invalid arguments/u)
  await bundle.codeModeExecutor.dispose()
}))

test('exec writes exact payload content without direct provider mutation tools', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const fileContent = 'const message = `literal ${value}`;\n'
  const result = await execute(bundle, 'return await tools.write({ path: "output.ts", content: payloads.file });', { file: fileContent })
  assert.equal(result.status, 'success', result.body)
  assert.equal(await fs.readFile(path.join(workspaceRootPath, 'output.ts'), 'utf8'), fileContent)
  await bundle.codeModeExecutor.dispose()
}))

test('Plan Mode exposes plan.create and blocks terminal and ordinary workspace writes', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
  assert.deepEqual(Object.keys(bundle.tools), ['exec'])
  assert.ok(bundle.registry.get('plan.create'))
  assert.ok(bundle.registry.get('patch'))
  assert.equal(bundle.registry.get('write'), undefined)
  assert.equal(bundle.registry.get('terminal.execute'), undefined)
  const unavailable = await execute(bundle, 'return await tools.terminal.execute({ command: "echo no" });')
  assert.equal(unavailable.status, 'error')
  const blocked = await execute(bundle, 'return await tools.patch({ patch: payloads.patch });', {
    patch: '*** Begin Patch\n*** Add File: injected.txt\n+not allowed\n*** End Patch',
  })
  assert.equal(blocked.status, 'error')
  assert.equal(await fs.stat(path.join(workspaceRootPath, 'injected.txt')).then(() => true, () => false), false)
  await bundle.codeModeExecutor.dispose()
}))

test('Plan Mode creates and revises the active plan through exact authorized APIs', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
  const created = await execute(bundle, 'return await tools.plan.create({ content: payloads.plan });', {
    plan: '# Build Plan\n\nOld detail.\n',
  })
  assert.equal(created.status, 'success', created.body)
  const planFile = path.join(workspaceRootPath, '.tidecode', 'plans')
  const names = await fs.readdir(planFile)
  assert.equal(names.length, 1)
  const relativePath = `.tidecode/plans/${names[0]}`
  const revised = await execute(bundle, 'return await tools.patch({ patch: payloads.patch });', {
    patch: `*** Begin Patch\n*** Update File: ${relativePath}\n@@\n-Old detail.\n+New detail.\n*** End Patch`,
  })
  assert.equal(revised.status, 'success', revised.body)
  assert.match(await fs.readFile(path.join(planFile, names[0]!), 'utf8'), /New detail/u)
  await bundle.codeModeExecutor.dispose()
}))
