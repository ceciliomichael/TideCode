import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { electronApp } from '../../electron/electronApp'
import { McpServerManager } from '../../electron/mcp/serverManager'

const EXPECTED_TOOL_ID = 'mcp_routegate_list_routes'

async function writeAutoConnectedMcpConfig(homePath: string) {
  const configDirectory = path.join(homePath, '.tidecode', 'mcp')
  const fixturePath = fileURLToPath(new URL('./fixtures/listToolsServer.mjs', import.meta.url))
  await fs.mkdir(configDirectory, { recursive: true })
  await fs.writeFile(
    path.join(configDirectory, 'mcp.json'),
    `${JSON.stringify({
      mcpServers: {
        routegate: {
          args: [fixturePath],
          command: process.execPath,
          tidecodeId: 'mcp-routegate-test',
          tidecodeToolNamespace: 'routegate',
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
            routegate: { autoConnect: true },
          },
        },
      },
    }, null, 2)}\n`,
    'utf8',
  )
}

test('saved MCP connections auto-connect for fresh workspace sessions and after restart', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-mcp-autoconnect-'))
  const workspacePath = path.join(tempHomePath, 'workspace')
  const originalGetPath = electronApp.getPath
  let manager: McpServerManager | null = null
  let restartedManager: McpServerManager | null = null

  try {
    electronApp.getPath = () => tempHomePath
    await fs.mkdir(workspacePath, { recursive: true })
    await writeAutoConnectedMcpConfig(tempHomePath)

    manager = new McpServerManager()
    const workspaceTools = await manager.getToolSet(workspacePath)
    assert.ok(EXPECTED_TOOL_ID in workspaceTools)

    const workspaceState = await manager.getState(workspacePath)
    const routegateConfig = workspaceState.configs.find((config) => config.name === 'routegate')
    assert.ok(routegateConfig)
    assert.equal(workspaceState.statuses[routegateConfig.id]?.status, 'connected')

    await manager.dispose()
    manager = null

    restartedManager = new McpServerManager()
    const restartedTools = await restartedManager.getToolSet(workspacePath)
    assert.ok(EXPECTED_TOOL_ID in restartedTools)
  } finally {
    await manager?.dispose()
    await restartedManager?.dispose()
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { recursive: true, force: true })
  }
})
