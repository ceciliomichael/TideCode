import { ipcMain } from 'electron'
import type { McpAddServerInput } from '../../src/types/mcp'
import { getMcpServerManager } from '../mcp/serverManager'

export function registerMcpHandlers(mcpServerManager: ReturnType<typeof getMcpServerManager>) {
  ipcMain.handle('mcp:getState', async (_event, workspacePath?: string | null) =>
    mcpServerManager.getState(workspacePath),
  )
  ipcMain.handle('mcp:addServer', async (_event, input: McpAddServerInput, workspacePath?: string | null) =>
    mcpServerManager.addServer(input, workspacePath),
  )
  ipcMain.handle('mcp:updateServer', async (_event, serverId: string, input: McpAddServerInput, workspacePath?: string | null) =>
    mcpServerManager.updateServer(serverId, input, workspacePath),
  )
  ipcMain.handle('mcp:connectServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.connectServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:disconnectServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.disconnectServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:removeServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.removeServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:refreshServer', async (_event, serverId: string, workspacePath?: string | null) =>
    mcpServerManager.refreshServer(serverId, workspacePath),
  )
  ipcMain.handle('mcp:toggleTool', async (_event, serverId: string, toolName: string, enabled: boolean, workspacePath?: string | null) =>
    mcpServerManager.toggleTool(serverId, toolName, enabled, workspacePath),
  )
}
