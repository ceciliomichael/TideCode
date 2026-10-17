import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { buildExecDescription } from '../../electron/chat/shared/ai/exec/exec'

async function withWorkspace(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))
  try { await run(root) } finally { await fs.rm(root, { recursive: true, force: true }) }
}

test('Agent Mode exposes one TideCode-owned exec tool and registered internal APIs', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent' })
  assert.deepEqual(Object.keys(bundle.tools), ['exec'])
  assert.ok(bundle.registry.get('read'))
  assert.ok(bundle.registry.get('patch'))
  assert.ok(bundle.registry.get('write'))
  assert.ok(bundle.registry.get('terminal.execute'))
  assert.ok(bundle.registry.get('terminal.read'))
  assert.ok(bundle.registry.get('terminal.interact'))
  assert.ok(bundle.registry.get('terminal.terminate'))
  assert.equal(bundle.registry.get('edit'), undefined)
  assert.equal(bundle.registry.get('apply_patch'), undefined)
  assert.equal(bundle.registry.get('mcp_tool_search'), undefined)
  assert.equal(bundle.registry.get('execute_mcp'), undefined)
  assert.equal(bundle.registry.get('plan.create'), undefined)
  assert.match(buildExecDescription(bundle.registry), /tools\.terminal\.execute/u)
  await bundle.codeModeExecutor.dispose()
}))

test('Plan Mode exposes only planning-safe APIs and the active-plan patch tool', async () => withWorkspace(async (workspaceRootPath) => {
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'plan' })
  assert.deepEqual(Object.keys(bundle.tools), ['exec'])
  for (const name of ['read', 'list', 'glob', 'grep', 'plan.create', 'patch']) {
    assert.ok(bundle.registry.get(name), name)
  }
  for (const name of ['write', 'terminal.execute', 'terminal.interact', 'terminal.read', 'terminal.terminate']) {
    assert.equal(bundle.registry.get(name), undefined)
  }
  await bundle.codeModeExecutor.dispose()
}))

test('Provider-native web_search is exposed separately when supported', async () => withWorkspace(async (workspaceRootPath) => {
  for (const providerId of ['openai', 'codex'] as const) {
    const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent', providerId })
    assert.deepEqual(Object.keys(bundle.tools).sort(), ['exec', 'web_search'])
    assert.equal(bundle.registry.get('web_search'), undefined)
    await bundle.codeModeExecutor.dispose()
  }
  const other = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent', providerId: 'custom:test-provider' })
  assert.deepEqual(Object.keys(other.tools), ['exec'])
  await other.codeModeExecutor.dispose()
}))

test('Skill APIs are independent documented operations when enabled', async () => withWorkspace(async (workspaceRootPath) => {
  const skills = [{
    name: 'example',
    description: 'Example skill',
    location: path.join(workspaceRootPath, 'SKILL.md'),
  }]
  await fs.writeFile(skills[0].location, '---\nname: example\ndescription: Example skill\n---\n# Example instructions\n')
  const bundle = await createAgentToolBundle({ workspaceRootPath }, { chatMode: 'agent', enabledSkills: skills })
  for (const name of ['skill.list', 'skill.search', 'skill.load']) assert.ok(bundle.registry.get(name))
  assert.equal(bundle.registry.get('skill'), undefined)
  const result = await bundle.codeModeExecutor.run('const s = await tools.skill.list({}); return s.body;')
  assert.equal(result.status, 'success', result.error)
  assert.match(String(result.output), /example/u)
  await bundle.codeModeExecutor.dispose()
}))
