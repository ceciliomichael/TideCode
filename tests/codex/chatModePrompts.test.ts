import '../configureAppRoot'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildChatModeSystemPrompt,
  buildChatModeSystemPromptBreakdown,
} from '../../electron/chat/shared/prompts/mode'
import { buildPromptContextManifest } from '../../electron/chat/cache/canonicalization'
import { createAgentToolBundle, createAgentTools, createNativeAgentTools } from '../../electron/chat/shared/tools'
import { approximateTokenCount } from '../../src/lib/contextUsage'
import { buildChatModeHiddenContext } from '../../src/lib/hiddenUserContext'

test('mode-neutral system prompt keeps stable core and workspace authority', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-system-prompt-'))

  try {
    const prompt = buildChatModeSystemPrompt('agent', workspaceRootPath)

    assert.doesNotMatch(prompt, /caveman|primitive speech/iu)
    assert.match(prompt, /<workspace_context>/u)
    assert.match(prompt, /<workspace_root authoritative="true" type="absolute">/u)
    assert.ok(prompt.includes(`\n${workspaceRootPath}\n</workspace_root>`))
    assert.match(prompt, /Use the exact value inside <workspace_root> as the only workspace root/u)
    assert.match(prompt, /Never guess or construct an absolute path/u)
    assert.doesNotMatch(prompt, /<terminal_environment>|Active terminal shell:/u)
    assert.match(prompt, /inspect with `list`, `glob`, or `grep` before choosing a path/u)
    assert.ok(approximateTokenCount(prompt) < 1_500)
    assert.match(prompt, /<decision_priority description="Required order for every model turn">/u)
    assert.match(prompt, /1\. Choose the next action: no tool, inspect, mutate, or verify/u)
    assert.match(prompt, /2\. Keep it inside the latest user request/u)
    assert.match(prompt, /3\. Use the narrowest exact tool and the smallest complete sequence/u)
    assert.match(prompt, /4\. Verify the requested result after the final mutation/u)
    assert.match(prompt, /Answer first/u)
    assert.match(prompt, /Latest compatible user request and current source evidence win/u)
    assert.match(prompt, /do not add features, cleanup, refactors, or future-proofing outside scope/u)
    assert.doesNotMatch(prompt, /Agent Mode|Plan Mode|<chat_mode_context|agent_mode_prompt|agent_tooling_instructions|<intent_rules/iu)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace root prompt markup escapes path text without changing the authoritative value', () => {
  const workspaceRootPath = 'C:\\workspace\\a&b<repo>'
  const prompt = buildChatModeSystemPrompt('agent', workspaceRootPath)

  assert.match(
    prompt,
    /<workspace_root authoritative="true" type="absolute">\nC:\\workspace\\a&amp;b&lt;repo&gt;\n<\/workspace_root>/u,
  )
  assert.doesNotMatch(prompt, /<workspace_root authoritative="true" type="absolute">\nC:\\workspace\\a&b<repo>/u)
})

test('prompt assembly keeps one stable core before workspace context', () => {
  const breakdown = buildChatModeSystemPromptBreakdown('agent', 'C:/workspace')
  const componentIds = breakdown.components.map((component) => component.id)

  assert.deepEqual(componentIds.slice(0, 5), [
    'core_decision_priority',
    'shared_mindset_prompt',
    'shared_response_prompt',
    'shared_continuation_prompt',
    'workspace_root',
  ])
  assert.ok(!componentIds.includes('shared_tooling_prompt'))
  assert.ok(
    breakdown.systemPrompt.indexOf('<decision_priority') <
      breakdown.systemPrompt.indexOf('<workspace_context>'),
  )
})

test('Code Mode prompt exposes only its meta-tool surface and compact async contract', () => {
  const codeModePrompt = buildChatModeSystemPrompt('agent', 'C:/workspace', { orchestrationMode: 'code_mode' })
  const hybridPrompt = buildChatModeSystemPrompt('agent', 'C:/workspace', { orchestrationMode: 'hybrid' })
  const directPrompt = buildChatModeSystemPrompt('agent', 'C:/workspace', { orchestrationMode: 'direct' })

  assert.match(codeModePrompt, /<code_mode_rules/u)
  assert.match(codeModePrompt, /The only model-facing tool in this turn is `code_mode`/u)
  assert.match(codeModePrompt, /`tools\.list` and `tools\.glob` are JavaScript APIs inside the `code_mode` program/u)
  assert.match(codeModePrompt, /Never emit a `tools\.\*` provider call/u)
  assert.match(codeModePrompt, /<decision_priority/u)
  assert.match(codeModePrompt, /Treat the `code_mode` tool description as the authoritative contract/u)
  assert.match(codeModePrompt, /smallest complete inspect, mutate, or verify sequence/u)
  assert.doesNotMatch(codeModePrompt, /\b(?:OpenAI|Codex|Anthropic|Google|DeepSeek|Mistral)\b/u)
  assert.doesNotMatch(codeModePrompt, /Unavailable host\/runtime APIs|Await every `tools\.\*` call|tools\.tool_search/u)
  assert.doesNotMatch(codeModePrompt, /Every `path` argument|targetContent|replacementContent/u)
  assert.doesNotMatch(codeModePrompt, /mcp_tool_search|execute_mcp/u)
  assert.ok(approximateTokenCount(codeModePrompt) < 1_500)
  assert.match(hybridPrompt, /Use a direct tool for one simple operation; use `code_mode` for related calls/u)
  assert.match(hybridPrompt, /tool description as authoritative for its inner APIs/u)
  assert.doesNotMatch(directPrompt, /<code_mode_rules/u)
})

test('Agent and Plan share a mode-neutral system while hidden contexts express mode state', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-mode-prompt-'))

  try {
    const agentPrompt = buildChatModeSystemPrompt('agent', workspaceRootPath, { orchestrationMode: 'code_mode' })
    const planPrompt = buildChatModeSystemPrompt('plan', workspaceRootPath, { orchestrationMode: 'code_mode' })
    const agentContext = buildChatModeHiddenContext('agent')
    const planContext = buildChatModeHiddenContext('plan')

    assert.equal(planPrompt, agentPrompt)
    assert.match(planPrompt, /<code_mode_rules/u)
    assert.doesNotMatch(planPrompt, /Agent Mode|Plan Mode|<chat_mode_context/iu)
    assert.equal(agentContext.kind, 'chat_mode')
    assert.equal(agentContext.state, 'agent')
    assert.match(agentContext.content, /mode="agent" state="active_until_superseded"/u)
    assert.match(agentContext.content, /explicit do-it requests do/u)
    assert.equal(planContext.kind, 'chat_mode')
    assert.equal(planContext.state, 'plan')
    assert.ok(planContext.content.includes('intentionally omitted from the permanent Code Mode documentation'))
    assert.ok(planContext.content.includes('Do not use tools.tool_search to discover tools.plan_create'))
    assert.ok(planContext.content.includes('stable superset of TideCode capabilities, not permission'))
    assert.match(planContext.content, /mode="plan" state="active_until_superseded"/u)
    assert.match(planContext.content, /tools\.plan_create/u)
    assert.match(planContext.content, /tools\.apply_patch/u)
    assert.match(planContext.content, /remains available but cannot revise a plan until one exists/u)
    assert.match(planContext.content, /Never mutate source files/u)
    assert.match(planContext.content, /latest successful Plan presentation/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('native tool catalog contains the internal executors used to build Code Mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-mode-tools-'),
  )

  try {
    const [agentTools, planTools] = await Promise.all([
      createAgentTools(
        { workspaceRootPath },
        { chatMode: 'agent', providerId: 'custom:test-provider' },
      ),
      createAgentTools(
        { workspaceRootPath },
        { chatMode: 'plan', providerId: 'custom:test-provider' },
      ),
    ])

    assert.deepEqual(Object.keys(agentTools).sort(), [
      'apply_patch',
      'edit',
      'execute_mcp',
      'execute_terminal',
      'glob',
      'grep',
      'interact_terminal',
      'kanban_board',
      'list',
      'mcp_tool_search',
      'read',
      'read_terminal',
      'read_tool_output',
      'terminate_terminal',
      'write',
    ])
    assert.deepEqual(Object.keys(planTools).sort(), [
      'apply_patch',
      'glob',
      'grep',
      'kanban_board',
      'list',
      'plan_create',
      'read',
      'read_tool_output',
    ])
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('plan mode excludes workspace mutation tools but permits Kanban planning actions', async () => {
  const workspaceRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-mode-native-tools-'),
  )

  try {
    const [agentTools, planTools] = await Promise.all([
      createNativeAgentTools(
        { workspaceRootPath },
        { chatMode: 'agent', providerId: 'custom:test-provider' },
      ),
      createNativeAgentTools(
        { workspaceRootPath },
        { chatMode: 'plan', providerId: 'custom:test-provider' },
      ),
    ])

    assert.ok('write' in agentTools)
    assert.ok('apply_patch' in agentTools)
    assert.ok('edit' in agentTools)
    assert.ok('execute_terminal' in agentTools)
    assert.ok(!('write' in planTools))
    assert.ok('apply_patch' in planTools)
    assert.ok(!('edit' in planTools))
    assert.ok(!('execute_terminal' in planTools))

    const planKanban = planTools.kanban_board
    assert.ok(planKanban)
    assert.equal(planKanban.description, 'Manage Kanban cards.')

    const revisionTools = await createNativeAgentTools(
      { workspaceRootPath },
      { activePlanPath: '.tidecode/plans/plan-001.md', chatMode: 'plan', providerId: 'custom:test-provider' },
    )
    assert.ok('apply_patch' in revisionTools)
    assert.ok('plan_create' in revisionTools)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('new Plan Mode Code Mode cannot attempt source mutation before creating the plan', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-mode-plan-mutation-'))

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'source.ts'), 'export const value = 1\n', 'utf8')
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'plan', orchestrationMode: 'code_mode', providerId: 'custom:test-provider' },
    )
    const codeMode = bundle.tools.code_mode as {
      execute?: (input: unknown, options: { context: unknown; messages: never[]; toolCallId: string }) => Promise<unknown>
    }

    try {
      const result = await codeMode.execute?.({
        source: [
          "return await tools.apply_patch({ patch: [",
          "  '*** Begin Patch',",
          "  '*** Update File: source.ts',",
          "  '@@',",
          "  '-export const value = 1',",
          "  '+export const value = 2',",
          "  '*** End Patch',",
          "] })",
        ].join('\n'),
      }, {
        context: {},
        messages: [],
        toolCallId: 'plan-source-mutation-blocked',
      }) as { semantics?: { tool_call_count?: number }; status?: string }

      assert.equal(result.status, 'error')
      assert.equal(result.semantics?.tool_call_count, 1)
      assert.equal(await fs.readFile(path.join(workspaceRootPath, 'source.ts'), 'utf8'), 'export const value = 1\n')
    } finally {
      await bundle.codeModeExecutor?.dispose()
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Agent and Plan keep the same provider-facing Code Mode cache context', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-mode-cache-'))
  const providerId = 'custom:test-provider' as const

  try {
    const [agentBundle, planBundle] = await Promise.all([
      createAgentToolBundle(
        { workspaceRootPath },
        { chatMode: 'agent', orchestrationMode: 'code_mode', providerId },
      ),
      createAgentToolBundle(
        { workspaceRootPath },
        { chatMode: 'plan', orchestrationMode: 'code_mode', providerId },
      ),
    ])
    const agentSystem = buildChatModeSystemPrompt('agent', workspaceRootPath, { orchestrationMode: 'code_mode' })
    const planSystem = buildChatModeSystemPrompt('plan', workspaceRootPath, { orchestrationMode: 'code_mode' })
    const agentManifest = buildPromptContextManifest({
      modelId: 'same-model',
      providerId,
      system: agentSystem,
      tools: agentBundle.tools,
    })
    const planManifest = buildPromptContextManifest({
      modelId: 'same-model',
      providerId,
      system: planSystem,
      tools: planBundle.tools,
    })

    assert.equal(agentManifest.systemHash, planManifest.systemHash)
    assert.equal(agentManifest.toolsHash, planManifest.toolsHash)
    assert.equal(agentManifest.fingerprint, planManifest.fingerprint)
    assert.ok(agentBundle.registry.get('plan_create'))
    assert.ok(planBundle.registry.get('plan_create'))
    const agentCodeMode = agentBundle.tools.code_mode as { description?: string }
    const planCodeMode = planBundle.tools.code_mode as { description?: string }
    assert.equal(agentCodeMode.description, planCodeMode.description)
    assert.doesNotMatch(agentCodeMode.description ?? '', /plan_create/u)

    await agentBundle.codeModeExecutor?.dispose()
    await planBundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace prompt delegates AGENTS.md delivery to runtime hidden context', async () => {
  const workspaceRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-workspace-prompt-'),
  )

  try {
    const embeddedInstructionNeedle = '<system_contract>embeddedInstructionNeedle</system_contract>'
    await fs.writeFile(
      path.join(workspaceRootPath, 'AGENTS.md'),
      embeddedInstructionNeedle,
      'utf8',
    )

    const breakdown = buildChatModeSystemPromptBreakdown('plan', workspaceRootPath)
    const prompt = breakdown.systemPrompt
    const contextComponent = breakdown.components.find(
      (component) => component.id === 'workspace_instructions_context',
    )

    assert.ok(contextComponent)
    assert.equal(contextComponent.source, 'electron/chat/shared/prompts/workspaceInstructions.ts')
    assert.match(prompt, /<workspace_instruction_context>/u)
    assert.match(prompt, /revision-aware hidden bootstrap context/u)
    assert.match(prompt, /bootstrap does not contain the file contents/u)
    assert.match(prompt, /Read the current `AGENTS\.md` only when that exact revision has not already been read/u)
    assert.match(prompt, /reuse it and do not read it again/u)
    assert.doesNotMatch(prompt, /you must read it/u)
    assert.doesNotMatch(prompt, /embeddedInstructionNeedle/u)
    assert.doesNotMatch(prompt, /&lt;system_contract&gt;embeddedInstructionNeedle/u)
    assert.equal(prompt.match(/<system_contract/gu)?.length, 1)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('workspace prompt is stable when AGENTS.md presence changes', async () => {
  const workspaceRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-workspace-prompt-no-agents-'),
  )

  try {
    const prompt = buildChatModeSystemPromptBreakdown('agent', workspaceRootPath, {
      orchestrationMode: 'code_mode',
    }).systemPrompt

    assert.match(prompt, /continue without attempting that bootstrap read/u)
    assert.doesNotMatch(prompt, /you must read `AGENTS\.md`|you must read it/u)

    await fs.writeFile(path.join(workspaceRootPath, 'AGENTS.md'), '# now present\n', 'utf8')
    const presentPrompt = buildChatModeSystemPromptBreakdown('agent', workspaceRootPath, {
      orchestrationMode: 'code_mode',
    }).systemPrompt
    assert.equal(presentPrompt, prompt)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('buildChatModeSystemPrompt remains stable when python venv state changes', async () => {
  const workspaceRootPath = await fs.mkdtemp(
    path.join(tmpdir(), 'tidecode-venv-prompt-'),
  )

  try {
    const promptWithoutVenv = buildChatModeSystemPrompt('agent', workspaceRootPath)
    const venvDir = path.join(workspaceRootPath, '.venv')
    await fs.mkdir(venvDir, { recursive: true })
    await fs.writeFile(path.join(venvDir, 'pyvenv.cfg'), 'home = /usr/bin/python\n', 'utf8')

    const promptWithVenv = buildChatModeSystemPrompt('agent', workspaceRootPath)
    assert.equal(promptWithVenv, promptWithoutVenv)
    assert.doesNotMatch(promptWithVenv, /Python virtual environment activated|<python_environment>/u)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
