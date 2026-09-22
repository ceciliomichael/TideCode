import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { electronApp } from '../../electron/electronApp'
import { getMcpServerManager, resetMcpServerManager } from '../../electron/mcp/serverManager'

async function readServerPid(workspacePath: string) {
  const manager = getMcpServerManager()
  const search = await manager.searchTools({ query: 'process id' }, workspacePath)
  const tool = search.tools[0]
  assert.ok(tool)

  const result = await manager.executeTool(tool.tool_id, {}, workspacePath)
  return Number(result.body)
}

test('equivalent workspace paths reuse one MCP runtime and release reconnects cleanly', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-mcp-lifecycle-'))
  const workspacePath = path.join(tempHomePath, 'workspace')
  const equivalentWorkspacePath = path.join(workspacePath, '.')
  const configDirectory = path.join(tempHomePath, '.tidecode', 'mcp')
  const fixturePath = fileURLToPath(new URL('./fixtures/processIdServer.mjs', import.meta.url))
  const originalGetPath = electronApp.getPath

  try {
    electronApp.getPath = () => tempHomePath
    await fs.mkdir(configDirectory, { recursive: true })
    await fs.mkdir(workspacePath, { recursive: true })
    await fs.writeFile(
      path.join(configDirectory, 'mcp.json'),
      `${JSON.stringify({
        mcpServers: {
          lifecycle: {
            args: [fixturePath],
            command: process.execPath,
            tidecodeId: 'mcp-lifecycle-test',
            tidecodeToolNamespace: 'lifecycle',
            type: 'stdio',
          },
        },
      }, null, 2)}\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(configDirectory, 'state.json'),
      `${JSON.stringify({
        workspaces: {
          __global__: {
            servers: {
              lifecycle: { autoConnect: true },
            },
          },
        },
      }, null, 2)}\n`,
      'utf8',
    )

    const firstPid = await readServerPid(workspacePath)
    const equivalentPid = await readServerPid(equivalentWorkspacePath)
    assert.equal(equivalentPid, firstPid)

    const manager = getMcpServerManager()
    await manager.releaseWorkspace(workspacePath)
    await manager.releaseWorkspace(workspacePath)

    const reconnectedPid = await readServerPid(workspacePath)
    assert.notEqual(reconnectedPid, firstPid)
  } finally {
    await resetMcpServerManager()
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { recursive: true, force: true })
  }
})
