import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { repairMisroutedCodeModeToolCall } from '../../electron/chat/shared/codeMode/toolCallRepair'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'

test('Code Mode repairs a misrouted tools.list provider call into code_mode', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-repair-'))

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )

    const repaired = repairMisroutedCodeModeToolCall({
      providerTools: bundle.tools,
      registry: bundle.registry,
      toolCall: {
        input: JSON.stringify({ path: '.' }),
        toolCallId: 'call-1',
        toolName: 'tools.list',
        type: 'tool-call',
      },
    })

    assert.ok(repaired)
    assert.equal(repaired.toolName, 'code_mode')
    assert.equal(repaired.toolCallId, 'call-1')
    const repairedInput = JSON.parse(repaired.input) as { code?: string }
    assert.match(repairedInput.code ?? '', /await tools\.list\(\{"path":"\."\}\)/u)
    assert.match(repairedInput.code ?? '', /return result;/u)

    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode repair rejects unknown inner tools and malformed input', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-repair-'))

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )

    assert.equal(repairMisroutedCodeModeToolCall({
      providerTools: bundle.tools,
      registry: bundle.registry,
      toolCall: {
        input: '{}',
        toolCallId: 'call-2',
        toolName: 'tools.not_real',
        type: 'tool-call',
      },
    }), null)

    assert.equal(repairMisroutedCodeModeToolCall({
      providerTools: bundle.tools,
      registry: bundle.registry,
      toolCall: {
        input: 'not-json',
        toolCallId: 'call-3',
        toolName: 'tools.list',
        type: 'tool-call',
      },
    }), null)

    await bundle.codeModeExecutor?.dispose()
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
