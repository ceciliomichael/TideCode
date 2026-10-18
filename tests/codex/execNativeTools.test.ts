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
import { formatAvailableApiSearch, searchAvailableApis } from '../../electron/chat/shared/ai/tools/available/search/search'
import { listAvailableApis } from '../../electron/chat/shared/ai/tools/available/list/list'

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

test('native tool pagination is lexically stable, bounded, and names-only', () => {
  const names = Array.from({ length: 13 }, (_, index) => ({ name: `tools.tool${String(index).padStart(2, '0')}`, namespace: 'filesystem', description: 'test' })).reverse()
  const first = listAvailableApis(names, 1, 'native')
  const second = listAvailableApis(names, 2, 'native')
  assert.equal(first.items.length, 10)
  assert.equal(first.hasMore, true)
  assert.deepEqual(first.items.map((item) => item.name), names.map((item) => item.name).sort().slice(0, 10))
  assert.equal(second.items.length, 3)
  assert.equal(second.hasMore, false)
  assert.deepEqual(Object.keys(first.items[0] ?? {}), ['name', 'description'])
  assert.deepEqual(listAvailableApis(names, 3, 'native').items, [])
})

test('listing namespaces pages independently', () => {
  const natives = Array.from({ length: 13 }, (_, i) => `tools.native${String(i).padStart(2, '0')}`)
  const names = [...natives.map((name) => ({ name, namespace: 'filesystem', description: 'Native' })),
    { name: 'tools.mcp.github_first', namespace: 'mcp', description: '[User MCP server "github"; original tool "first"]' },
    { name: 'tools.mcp.github_second', namespace: 'mcp', description: '[User MCP server "github"; original tool "second"]' },
    { name: 'tools.mcp.other_first', namespace: 'mcp', description: '[User MCP server "other"; original tool "first"]' }]
  assert.deepEqual(listAvailableApis(names, 1).items.map(({ name }) => name), ['github', 'native', 'other'])
  assert.deepEqual(listAvailableApis(names, 1, 'native').items.map(({ name }) => name), natives.slice(0, 10))
  assert.deepEqual(listAvailableApis(names, 2, 'native').items.map(({ name }) => name), natives.slice(10))
  assert.equal(listAvailableApis(names, 2, 'native').hasMore, false)
  assert.deepEqual(listAvailableApis(names, 1, 'mcp').items, [])
  assert.deepEqual(listAvailableApis(names, 1, 'github').items.map(({ name }) => name), ['tools.mcp.github_first', 'tools.mcp.github_second'])
  assert.deepEqual(listAvailableApis(names, 1, 'other').items.map(({ name }) => name), ['tools.mcp.other_first'])
  const renamed = [{ name: 'tools.mcp.github_enterprise_get', namespace: 'mcp', description: '[User MCP server "GitHub Enterprise"; original tool "get"; namespace "github_enterprise"] Read issue' }]
  assert.deepEqual(listAvailableApis(renamed, 1).items.map(({ name }) => name), ['github_enterprise'])
  assert.deepEqual(listAvailableApis(renamed, 1, 'github_enterprise').items.map(({ name }) => name), ['tools.mcp.github_enterprise_get'])
  assert.equal(listAvailableApis(renamed, 1, 'github_enterprise').items[0]?.description, 'Read issue')
  assert.equal(listAvailableApis([{ name: 'tools.edit', namespace: 'filesystem', description: 'full API contract' }], 1, 'native').items[0]?.description, 'Preferred for exact text replacements across files.')
  assert.equal(searchAvailableApis(renamed.map(({ name, namespace, description }) => ({ path: name, namespace, description, signature: 'mock' })), { namespace: 'github_enterprise', query: 'issue' }).items.length, 1)
})

test('root namespace index stays capped at 10 per page', () => {
  const servers = Array.from({ length: 14 }, (_, index) => ({
    name: `tools.mcp.server${String(index).padStart(2, '0')}_action`,
    namespace: 'mcp',
    description: `[User MCP server "server${String(index).padStart(2, '0')}"; original tool "action"] Perform action`,
  }))
  servers.push({ name: 'tools.read', namespace: 'filesystem', description: 'Read file' })
  assert.equal(listAvailableApis(servers, 1).items.length, 10)
  assert.equal(listAvailableApis(servers, 1).hasMore, true)
  assert.equal(listAvailableApis(servers, 2).items.length, 5)
  assert.deepEqual(listAvailableApis(servers, 1, 'server12').items.map((item) => item.name), ['tools.mcp.server12_action'])
  assert.deepEqual(listAvailableApis(servers, 1, 'mcp').items, [])
})

test('searching an MCP server name discovers all its authorized tools without mixing servers', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    path: `tools.mcp.acme_tool_${i}`,
    description: `[User MCP server "Acme Tools"; original tool "tool_${i}"] Example capability`,
    namespace: 'mcp', signature: 'mock',
  }))
  entries.push({ path: 'tools.mcp.other_tool', description: '[User MCP server "Other"; original tool "tool"] Example capability', namespace: 'mcp', signature: 'mock' })
  const found = searchAvailableApis(entries, { query: 'Acme Tools' })
  assert.equal(found.items.length, 10)
  assert.equal(found.remaining, 2)
  assert.ok(found.items.every(({ name }) => name.startsWith('tools.mcp.acme_')))
  assert.ok(found.items.every(({ description }) => description === 'Example capability'))
  const displayed = formatAvailableApiSearch(found, { query: 'Acme Tools' })
  assert.match(displayed, /`tools\.mcp\.acme_tool_0` - Example capability/u)
  assert.doesNotMatch(displayed, /original tool|inputSchema|## Call/u)
  const limited = searchAvailableApis(entries, { query: 'Acme Tools', limit: 5 })
  assert.equal(limited.items.length, 5)
  assert.deepEqual(limited.next, { offset: 5 })
  const scoped = searchAvailableApis(entries, { query: 'capability', namespace: 'acme tools' })
  assert.equal(scoped.items.length, 10)
  assert.equal(scoped.remaining, 2)
})

test('search prioritizes exact tool-name tokens over incidental description matches', () => {
  const entries = [
    { path: 'tools.mcp.routes_create', description: '[User MCP server "routes"; original tool "create"] Create a route', namespace: 'mcp', signature: '' },
    { path: 'tools.mcp.routes_list', description: '[User MCP server "routes"; original tool "list"] List existing routes; create operations are not supported', namespace: 'mcp', signature: '' },
  ]
  const found = searchAvailableApis(entries, { query: 'create route' })
  assert.equal(found.items[0]?.name, 'tools.mcp.routes_create')
  assert.equal(searchAvailableApis(entries, { query: 'route', limit: 50 }).items.length, 2)
})

test('search rejects invalid arguments instead of silently falling back to defaults', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  for (const input of [
    '{ limit: 11 }', '{ offset: -1 }', '{ query: 123 }',
    '{ namespace: "" }', '{ surprise: true }',
  ]) {
    const outcome = await execute(bundle, `return await tools.available.search(${input});`)
    assert.equal(outcome.status, 'error', input)
  }
  await bundle.codeModeExecutor.dispose()
}))

test('only exec is TideCode provider-facing and native APIs have exact paths', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent', providerId: 'custom:test-provider' })
  assert.deepEqual(Object.keys(bundle.tools), ['exec'])
  for (const name of ['read', 'list', 'glob', 'grep', 'terminal.execute', 'terminal.read', 'terminal.interact', 'terminal.terminate', 'edit', 'patch', 'write']) {
    assert.ok(bundle.registry.get(name), name)
    assert.ok(getApiInstructions(name).length > 0)
  }
  for (const obsolete of ['execute_terminal', 'apply_patch', 'plan_create', 'skill', 'mcp_tool_search']) {
    assert.equal(bundle.registry.get(obsolete), undefined)
  }
  await bundle.codeModeExecutor.dispose()
}))

test('exec exposes only discovery APIs and has stable metadata across modes', async () => withWorkspace(async (workspaceRootPath) => {
  const agent = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const plan = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
  const description = agent.tools.exec.description ?? ''
  assert.equal(description, plan.tools.exec.description)
  assert.match(description, /tools\.available\.list/u)
  assert.match(description, /tools\.available\.search/u)
  assert.match(description, /tools\.available\.get/u)
  assert.doesNotMatch(description, /tools\.terminal\.execute|# tools\.read/u)
  await agent.codeModeExecutor.dispose()
  await plan.codeModeExecutor.dispose()
}))

test('native list is paged, names-only and mode-aware', async () => withWorkspace(async (workspaceRootPath) => {
  const agent = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  const plan = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
  const agentList = await execute(agent, 'return await tools.available.list({ namespace: "native", page: 1 });')
  const planList = await execute(plan, 'return await tools.available.list({ namespace: "native", page: 1 });')
  assert.equal(agentList.status, 'success', agentList.body)
  assert.equal(planList.status, 'success', planList.body)
  assert.match(agentList.body ?? '', /tools\.terminal\.execute/u)
  assert.doesNotMatch(planList.body ?? '', /tools\.terminal\.|tools\.write|tools\.mcp\./u)
  assert.match(planList.body ?? '', /tools\.plan\.create/u)
  assert.doesNotMatch(agentList.body ?? '', /tools\.plan\.create/u)
  assert.doesNotMatch(agentList.body ?? '', /inputSchema|description/u)
  assert.match(agentList.body ?? '', /# Available native tools \(page 1\)/u)
  assert.match(agentList.body ?? '', /- `tools\.read`/u)
  assert.doesNotMatch(agentList.body ?? '', /"items"|"hasMore"/u)
  const invalid = await execute(agent, 'return await tools.available.list({ page: 0 });')
  assert.equal(invalid.status, 'error')
  const rootList = await execute(agent, 'return await tools.available.list();')
  assert.match(rootList.body ?? '', /# Available tool namespaces \(page 1\)/u)
  assert.match(rootList.body ?? '', /- `native`/u)
  const later = await execute(agent, 'return await tools.available.list({ namespace: "native", page: 2 });')
  assert.equal(later.status, 'success', later.body)
  await agent.codeModeExecutor.dispose()
  await plan.codeModeExecutor.dispose()
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
  assert.match(body, /Read the contents of one existing text file or image/u)
  const searchOnly = await execute(bundle, 'return await tools.available.search({ query: "tools.read", namespace: "native" });')
  assert.match(searchOnly.body ?? '', /Read file or image contents\./u)
  assert.doesNotMatch(searchOnly.body ?? '', /## Call|## Parameters/u)
  assert.match(searchOnly.body ?? '', /# Tool search: tools\.read/u)
  assert.match(searchOnly.body ?? '', /- `tools\.read`/u)
  assert.doesNotMatch(searchOnly.body ?? '', /"items"|"remaining"|"next"/u)
  const empty = await execute(bundle, 'return await tools.available.search({ query: "unfindable_tool_123456" });')
  assert.match(empty.body ?? '', /No matching tools found\./u)
  assert.doesNotMatch(empty.body ?? '', /"items"/u)
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
    description: '[User MCP server "github"; original tool "search_repositories"] Search GitHub repositories for text.',
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
  const found = await executor.run('return await tools.available.search({ query: "GitHub repositories", namespace: "github" });')
  assert.equal(found.status, 'success', found.error)
  assert.match(found.output as string, /- `tools\.mcp\.search_repositories`/u)
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
  const listedExecutor = new CodeModeExecutor(registry, undefined, { workspaceRootPath })
  const namespaces = await listedExecutor.run('return await tools.available.list();')
  assert.match(namespaces.output as string, /- `github`/u)
  const listed = await listedExecutor.run('return await tools.available.list({ namespace: "github", page: 1 });')
  assert.equal(listed.status, 'success')
  assert.match(listed.output as string, /- `tools\.mcp\.search_repositories`/u)
  const listedContract = await listedExecutor.run('return await tools.available.get({ name: "tools.mcp.search_repositories" });')
  assert.equal(listedContract.status, 'success', listedContract.error)
  await listedExecutor.dispose()
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
    'return { found, file: file.body };',
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
