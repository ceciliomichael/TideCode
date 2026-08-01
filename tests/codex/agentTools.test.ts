import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'

test('createAgentTools omits write tools in plan mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

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
    assert.ok('kanban_board' in tools)
    assert.ok(!('write' in tools))
    assert.ok(!('edit' in tools))
    assert.ok(!('apply_patch' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
test('createAgentTools exposes write tools in agent mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('write' in tools)
    assert.ok('edit' in tools)
    assert.ok(!('apply_patch' in tools))
    assert.ok('kanban_board' in tools)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools exposes Codex web_search as a provider tool', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const codexTools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'codex' },
    )
    const compatibleTools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent', providerId: 'custom:test-provider' },
    )

    for (const toolName of [
      'edit',
    ]) {
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
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

  try {
    const tools = await createAgentTools({
      workspaceRootPath,
    }, {
      chatMode: 'agent',
    })

    assert.ok('grep' in tools)
    const grepTool = tools.grep as { description?: string }

    assert.match(grepTool.description ?? '', /Searches file contents/u)
    assert.doesNotMatch(grepTool.description ?? '', /use `read`|apply_patch|should|prefer/iu)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps plan mode tool descriptions literal', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

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

    assert.match(listTool.description ?? '', /Lists direct contents/u)
    assert.match(readTool.description ?? '', /Reads file contents/u)
    assert.match(globTool.description ?? '', /Finds file paths/u)
    assert.match(grepTool.description ?? '', /Searches file contents/u)
    for (const description of [listTool, readTool, globTool, grepTool].map((tool) => tool.description ?? '')) {
      assert.doesNotMatch(description, /use `read`|apply_patch|write|should|prefer/iu)
    }
    assert.ok(!('write' in tools))
    assert.ok(!('edit' in tools))
    assert.ok(!('apply_patch' in tools))
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('createAgentTools keeps mutation descriptions mechanical and workflow-free', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'echosphere-tools-'))

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
    assert.ok('edit' in tools)
    assert.ok('write' in tools)

    const readTool = tools.read as { description?: string }
    const globTool = tools.glob as { description?: string }
    const grepTool = tools.grep as { description?: string }
    const replaceTool = tools.edit as { description?: string }
    const writeTool = tools.write as { description?: string }

    assert.match(readTool.description ?? '', /Reads file contents/u)
    assert.match(replaceTool.description ?? '', /Replaces a block of text/u)
    assert.match(globTool.description ?? '', /Finds file paths/u)
    assert.match(grepTool.description ?? '', /Searches file contents/u)
    assert.match(writeTool.description ?? '', /Writes content to a file/u)
    for (const description of [
      readTool,
      globTool,
      grepTool,
      replaceTool,
      writeTool,
    ]
      .map((tool) => tool.description ?? '')) {
      assert.doesNotMatch(description, /should|prefer|after reading|before editing/iu)
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
