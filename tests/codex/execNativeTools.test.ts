import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { asSchema } from 'ai'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import type { AgentToolRegistry, AgentToolRegistryEntry } from '../../electron/chat/shared/tools/registry'
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

test('exec lists native names without preloading their full instructions', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const description = bundle.tools.exec.description ?? ''
  assert.match(description, /tools\.read/u)
  assert.match(description, /tools\.available\.get/u)
  assert.doesNotMatch(description, /# tools\.read/u)
  assert.doesNotMatch(description, /Read one file or directory/u)
  await bundle.codeModeExecutor.dispose()
}))

test('search returns names only; exact get exposes documentation and schema', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const result = await execute(bundle, [
    'const found = await tools.available.search({ query: "tools.read", namespace: "native" });',
    'const info = await tools.available.get({ name: "tools.read" });',
    'return { found, info };',
  ].join('\n'))
  assert.equal(result.status, 'success', result.body)
  const body = result.body ?? ''
  assert.match(body, /# tools\.read/u)
  assert.match(body, /await tools\.read\(input:/u)
  assert.doesNotMatch(body, /"inputSchema"/u)
  assert.match(body, /Read one existing file or directory/u)
  const searchOnly = await execute(bundle, 'return await tools.available.search({ query: "tools.read", namespace: "native" });')
  assert.doesNotMatch(searchOnly.body ?? '', /Read one existing file or directory/u)
  await bundle.codeModeExecutor.dispose()
}))

test('get is required before native execution and remains valid for later exec calls', async () => withWorkspace(async (workspaceRootPath) => {
  await fs.writeFile(path.join(workspaceRootPath, 'note.txt'), 'verified\n')
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const blocked = await execute(bundle, 'return await tools.read({ path: "note.txt" });')
  assert.equal(blocked.status, 'success')
  assert.match(blocked.body ?? '', /retrieved them now/u)
  assert.equal(blocked.semantics?.tool_calls?.[0]?.name, 'available.get')
  const obtained = await execute(bundle, 'return await tools.available.get({ name: "tools.read" });')
  assert.equal(obtained.status, 'success', obtained.body)
  const allowed = await execute(bundle, 'return await tools.read({ path: "note.txt" });')
  assert.equal(allowed.status, 'success', allowed.body)
  assert.match(allowed.body ?? '', /verified/u)
  await bundle.codeModeExecutor.dispose()
}))

test('multiple contract retrievals emit visible nested receipts instead of only Ran code', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const result = await execute(bundle, [
    'const first = await tools.available.get({ name: "tools.read" });',
    'const second = await tools.available.get({ name: "tools.list" });',
    'return [first, second];',
  ].join('\n'))
  assert.equal(result.status, 'success', result.body)
  const calls = result.semantics?.tool_calls ?? []
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.name === 'available.get' && call.status === 'success'))
  await bundle.codeModeExecutor.dispose()
}))

test('discovery state is isolated by chat and Plan Mode', async () => withWorkspace(async (workspaceRootPath) => {
  await fs.writeFile(path.join(workspaceRootPath, 'note.txt'), 'isolated\n')
  const conversationId = 'discovery-isolation-test'
  const first = await createAgentToolBundle({ workspaceRootPath, conversationId }, { chatMode: 'agent' })
  await execute(first, 'return await tools.available.get({ name: "tools.read" });')
  const subsequent = await createAgentToolBundle({ workspaceRootPath, conversationId }, { chatMode: 'agent' })
  assert.equal((await execute(subsequent, 'return await tools.read({ path: "note.txt" });')).status, 'success')
  const another = await createAgentToolBundle({ workspaceRootPath, conversationId: 'other-chat' }, { chatMode: 'agent' })
  const otherFirst = await execute(another, 'return await tools.read({ path: "note.txt" });')
  assert.equal(otherFirst.semantics?.tool_calls?.[0]?.name, 'available.get')
  const plan = await createAgentToolBundle({ workspaceRootPath, conversationId }, { chatMode: 'plan' })
  const planFirst = await execute(plan, 'return await tools.read({ path: "note.txt" });')
  assert.equal(planFirst.semantics?.tool_calls?.[0]?.name, 'available.get')
  assert.equal((await execute(plan, 'return await tools.available.get({ name: "tools.write" });')).status, 'error')
  for (const bundle of [first, subsequent, another, plan]) await bundle.codeModeExecutor.dispose()
}))

test('MCP requires search then exact get; search exposes names only', async () => withWorkspace(async (workspaceRootPath) => {
  let executions = 0
  const entry: AgentToolRegistryEntry = {
    name: 'mcp_search_repositories',
    namespace: 'mcp',
    description: 'Search GitHub repositories for text.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: async () => {
      executions += 1
      return { status: 'success', summary: 'Found repository', body: '{"name":"example"}' }
    },
  }
  const registry: AgentToolRegistry = {
    entries: [entry],
    get: (name) => name === entry.name ? entry : undefined,
    search: () => [],
  }
  const executor = new CodeModeExecutor(registry, undefined, { workspaceRootPath })
  const unknown = await executor.run('return await tools.available.get({ name: "tools.mcp.search_repositories" });')
  assert.equal(unknown.status, 'error')
  assert.match(unknown.error ?? '', /Discover MCP API/u)
  const found = await executor.run('return await tools.available.search({ query: "GitHub repositories", namespace: "mcp" });')
  assert.equal(found.status, 'success', found.error)
  assert.deepEqual((found.output as { items: unknown[] }).items, [{ name: 'tools.mcp.search_repositories' }])
  const denied = await executor.run('return await tools.mcp.search_repositories({ query: "test" });')
  assert.equal(denied.status, 'success')
  assert.equal(denied.toolCalls[0]?.name, 'available.get')
  assert.equal(executions, 0)
  const fetched = await executor.run('return await tools.available.get({ name: "tools.mcp.search_repositories" });')
  assert.equal(fetched.status, 'success', fetched.error)
  assert.match(fetched.output as string, /GitHub repositories/u)
  const executed = await executor.run('return await tools.mcp.search_repositories({ query: "test" });')
  assert.equal(executed.status, 'success', executed.error)
  assert.equal(executions, 1)
  await executor.dispose()
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
    'await tools.available.get({ name: "tools.read" });',
    'const file = await tools.read({ path: "sample.txt" });',
    'return { found: found.items.map(x => x.name), file: file.body };',
  ].join('\n'))
  assert.equal(result.status, 'success', result.body)
  assert.match(result.body ?? '', /tools\.terminal\.execute/u)
  assert.match(result.body ?? '', /actual file contents/u)
  await bundle.codeModeExecutor.dispose()
}))

test('exec preserves readable nested file contents in the displayed receipt beyond 2,000 characters', async () => withWorkspace(async (workspaceRootPath) => {
  const fileContent = Array.from({ length: 100 }, (_, index) => `line ${index + 1}: ${'record '.repeat(8)}`).join('\n')
  await fs.writeFile(path.join(workspaceRootPath, 'large.txt'), fileContent)
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const result = await execute(bundle, 'await tools.available.get({ name: "tools.read" }); return await tools.read({ path: "large.txt" });')
  assert.equal(result.status, 'success', result.body)
  const read = result.semantics?.tool_calls?.find((call) => call.name === 'read') as { body?: string; summary: string } | undefined
  assert.ok(read)
  assert.match(read.summary, /Read large\.txt/u)
  assert.ok((read.body?.length ?? 0) > 2_000)
  assert.match(read.body ?? '', /line 100:/u)
  await bundle.codeModeExecutor.dispose()
}))

test('unsupported native API names and unknown parameters fail instead of falling back', async () => withWorkspace(async (workspaceRootPath) => {
  await fs.writeFile(path.join(workspaceRootPath, 'sample.txt'), 'contents\n')
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const obsolete = await execute(bundle, 'return await tools.execute_terminal({ command: "echo invalid" });')
  assert.equal(obsolete.status, 'error')
  assert.match(obsolete.body ?? '', /UnknownTool/u)
  const extra = await execute(bundle, 'await tools.available.get({ name: "tools.read" }); return await tools.read({ path: "sample.txt", invented: true });')
  assert.equal(extra.status, 'error')
  assert.match(extra.body ?? '', /Invalid arguments/u)
  await bundle.codeModeExecutor.dispose()
}))

test('exec writes exact payload content without direct provider mutation tools', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const fileContent = 'const message = `literal ${value}`;\n'
  const result = await execute(bundle, 'await tools.available.get({ name: "tools.write" }); return await tools.write({ path: "output.ts", content: payloads.file });', { file: fileContent })
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
  const blocked = await execute(bundle, 'await tools.available.get({ name: "tools.patch" }); return await tools.patch({ patch: payloads.patch });', {
    patch: '*** Begin Patch\n*** Add File: injected.txt\n+not allowed\n*** End Patch',
  })
  assert.equal(blocked.status, 'error')
  assert.equal(await fs.stat(path.join(workspaceRootPath, 'injected.txt')).then(() => true, () => false), false)
  await bundle.codeModeExecutor.dispose()
}))

test('Plan Mode creates and revises the active plan through exact authorized APIs', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
  const created = await execute(bundle, 'await tools.available.get({ name: "tools.plan.create" }); return await tools.plan.create({ content: payloads.plan });', {
    plan: '# Build Plan\n\nOld detail.\n',
  })
  assert.equal(created.status, 'success', created.body)
  const planFile = path.join(workspaceRootPath, '.tidecode', 'plans')
  const names = await fs.readdir(planFile)
  assert.equal(names.length, 1)
  const relativePath = `.tidecode/plans/${names[0]}`
  const revised = await execute(bundle, 'await tools.available.get({ name: "tools.patch" }); return await tools.patch({ patch: payloads.patch });', {
    patch: `*** Begin Patch\n*** Update File: ${relativePath}\n@@\n-Old detail.\n+New detail.\n*** End Patch`,
  })
  assert.equal(revised.status, 'success', revised.body)
  assert.match(await fs.readFile(path.join(planFile, names[0]!), 'utf8'), /New detail/u)
  await bundle.codeModeExecutor.dispose()
}))
