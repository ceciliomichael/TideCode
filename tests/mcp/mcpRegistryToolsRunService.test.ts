import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createConnectedMcpRegistryTools } from '../../electron/chat/shared/tools/mcpRegistryTools'
import { electronApp } from '../../electron/electronApp'
import { resetMcpServerManager } from '../../electron/mcp/serverManager'
import { RUN_SERVICE_BUILD_ID_ENV } from '../../electron/runService/buildIdentity'

const EXPECTED_TOOL_ID = 'mcp_routegate_list_routes'

test('packaged Node run-service exposes connected MCP tools to Code Mode', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-mcp-run-service-'))
  const workspacePath = path.join(tempHomePath, 'workspace')
  const configDirectory = path.join(tempHomePath, '.tidecode', 'mcp')
  const fixturePath = fileURLToPath(new URL('./fixtures/listToolsServer.mjs', import.meta.url))
  const originalGetPath = electronApp.getPath
  const originalBuildId = process.env[RUN_SERVICE_BUILD_ID_ENV]

  try {
    electronApp.getPath = () => tempHomePath
    process.env[RUN_SERVICE_BUILD_ID_ENV] = 'a'.repeat(64)
    await fs.mkdir(configDirectory, { recursive: true })
    await fs.mkdir(workspacePath, { recursive: true })
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

    const tools = await createConnectedMcpRegistryTools({ workspaceRootPath: workspacePath })
    assert.ok(EXPECTED_TOOL_ID in tools)
  } finally {
    await resetMcpServerManager()
    electronApp.getPath = originalGetPath
    if (originalBuildId === undefined) {
      delete process.env[RUN_SERVICE_BUILD_ID_ENV]
    } else {
      process.env[RUN_SERVICE_BUILD_ID_ENV] = originalBuildId
    }
    await fs.rm(tempHomePath, { recursive: true, force: true })
  }
})
