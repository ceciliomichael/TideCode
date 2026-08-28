import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createAgentToolBundle, createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'

test('createAgentTools omits write tools in plan mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'plan',
      },
    )

    assert.ok('list' in tools)
    assert.ok('read' in tools)
    assert.ok('read_tool_output' in tools)
    assert.ok('kanban_board' in tools)
    assert.ok(!('memory' in tools))
    assert.ok('plan_create' in tools)
    assert.ok(!('plan_edit' in tools))
    assert.ok(!('write' in tools))
    assert.ok('apply_patch' in tools)
    assert.ok(!('edit' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
test('createAgentTools exposes write tools in agent mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('write' in tools)
    assert.ok(!('plan_create' in tools))
    assert.ok('apply_patch' in tools)
    assert.ok('edit' in tools)
    assert.ok('kanban_board' in tools)
    assert.ok(!('memory' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode exposes one provider tool while discovery and native executors stay in its registry', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-tools-'))

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )

assert.deepEqual(Object.keys(bundle.tools), ['code_mode'])
    assert.ok(bundle.registry.get('tool_search'))
    assert.ok(bundle.registry.get('read'))
    assert.ok(bundle.registry.get('read_tool_output'))
    assert.ok(bundle.registry.get('apply_patch'))
    assert.equal(bundle.registry.get('edit'), undefined)
    assert.ok(bundle.nativeTools.edit)
    assert.equal(bundle.registry.get('mcp_tool_search'), undefined)
    assert.equal(bundle.registry.get('execute_mcp'), undefined)
    assert.equal(typeof bundle.registry.get('read')?.execute, 'function')
    const codeModeWriteSchema = bundle.registry.get('write')?.inputSchema as { properties?: Record<string, unknown> } | undefined
    assert.equal(Boolean(codeModeWriteSchema?.properties && 'expectedRevision' in codeModeWriteSchema.properties), false)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentToolBundle defaults agent mode to Code Mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-default-code-mode-tools-'))

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )

assert.deepEqual(Object.keys(bundle.tools), ['code_mode'])
    assert.ok(bundle.registry.get('tool_search'))
    assert.ok(bundle.codeModeExecutor)
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Hybrid orchestration retains direct tools alongside the meta-tools', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-hybrid-tools-'))

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'hybrid' },
    )

    assert.ok('read' in bundle.tools)
    assert.ok('read_tool_output' in bundle.tools)
    assert.ok('code_mode' in bundle.tools)
    assert.ok(!('tool_search' in bundle.tools))
    assert.ok(bundle.registry.get('tool_search'))
    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes Codex web_search as a provider tool', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'codex',
      },
    )

    const webSearchTool = tools.web_search as { id?: string; type?: string }

    assert.equal(webSearchTool.type, 'provider')
    assert.equal(webSearchTool.id, 'openai.web_search')
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools does not expose webfetch for non-Codex providers', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
        providerId: 'custom:test-provider',
      },
    )

    assert.ok(!('webfetch' in tools))
    assert.ok(!('web_search' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes the same exact replacement tools for every provider', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const codexTools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'codex' },
    )
    const compatibleTools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'custom:test-provider' },
    )

    for (const toolName of ['apply_patch', 'edit']) {
      const codexTool = codexTools[toolName] as {
        description?: string
        inputSchema?: unknown
      }
      const compatibleTool = compatibleTools[toolName] as {
        description?: string
        inputSchema?: unknown
      }
      assert.equal(codexTool.description, compatibleTool.description)
      assert.ok(codexTool.inputSchema)
      assert.ok(compatibleTool.inputSchema)
    }

    assert.ok('web_search' in codexTools)
    assert.ok(!('webfetch' in compatibleTools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools describes grep mechanics without workflow guidance', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('grep' in tools)
    const grepTool = tools.grep as { description?: string }

    assert.equal(grepTool.description, 'Search file contents under exactly one existing file or directory; an omitted path, empty string, or "." refers to the bound workspace root.')
    assert.doesNotMatch(grepTool.description ?? '', /use `read`|patch|should|prefer/iu)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps plan mode tool descriptions literal', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'plan',
      },
    )

    const listTool = tools.list as { description?: string }
    const readTool = tools.read as { description?: string }
    const globTool = tools.glob as { description?: string }
    const grepTool = tools.grep as { description?: string }

    assert.equal(listTool.description, 'List exactly one existing directory; an omitted path, empty string, or "." refers to the bound workspace root. Use read for files.')
    assert.equal(readTool.description, 'Read exactly one existing text file, image, or directory; an empty string or "." refers to the bound workspace root. By default, returns up to 500 lines. Set full_file: true to read the complete text file; full_file takes precedence over offset and limit.')
    assert.equal(globTool.description, 'Find files by pattern under exactly one directory; an omitted path, empty string, or "." refers to the bound workspace root.')
    assert.equal(grepTool.description, 'Search file contents under exactly one existing file or directory; an omitted path, empty string, or "." refers to the bound workspace root.')
    for (const description of [listTool, readTool, globTool, grepTool].map((tool) => tool.description ?? '')) {
      assert.doesNotMatch(description, /patch|write|should|prefer/iu)
    }
    assert.ok(!('write' in tools))
    assert.ok('apply_patch' in tools)
    assert.ok(!('edit' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps mutation descriptions mechanical and workflow-free', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tools-'))

  try {
    const tools = await createAgentTools(
      {
        workspaceRootPath,
      },
      {
        chatMode: 'agent',
      },
    )

    assert.ok('read' in tools)
    assert.ok('apply_patch' in tools)
    assert.ok('edit' in tools)
    assert.ok('write' in tools)

    const readTool = tools.read as { description?: string }
    const globTool = tools.glob as { description?: string }
    const grepTool = tools.grep as { description?: string }
    const applyPatchTool = tools.apply_patch as { description?: string }
    const editTool = tools.edit as { description?: string }
    const writeTool = tools.write as { description?: string }

    assert.equal(readTool.description, 'Read exactly one existing text file, image, or directory; an empty string or "." refers to the bound workspace root. By default, returns up to 500 lines. Set full_file: true to read the complete text file; full_file takes precedence over offset and limit.')
    assert.match(applyPatchTool.description ?? '', /Apply a Codex patch as an array of complete patch lines/u)
    assert.equal(
      editTool.description,
'Edit an existing file using one exact operation per hunk: replace targetContent, replace an exact startLine/endLine range, or insert insertContent at the file start/end. Ambiguous text targets return recoverable candidate context unless replaceAll is explicitly true.',
    )
    assert.equal(globTool.description, 'Find files by pattern under exactly one directory; an omitted path, empty string, or "." refers to the bound workspace root.')
    assert.equal(grepTool.description, 'Search file contents under exactly one existing file or directory; an omitted path, empty string, or "." refers to the bound workspace root.')
    assert.equal(
      writeTool.description,
      'Write a complete file using structured content. Use this tool to create files or intentionally replace an entire file.',
    )
    for (const description of [
      readTool,
      globTool,
      grepTool,
      applyPatchTool,
      editTool,
      writeTool,
    ]
      .map((tool) => tool.description ?? '')) {
      assert.doesNotMatch(description, /should|prefer|before editing/iu)
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
