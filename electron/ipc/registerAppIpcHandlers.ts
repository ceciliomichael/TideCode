import { ipcMain } from 'electron'
import { cleanupExpiredApiKeyHandoffs, consumeApiKeyHandoff } from '../cli/apiKeyHandoff'

export function registerAppIpcHandlers(): void {
  void cleanupExpiredApiKeyHandoffs().catch((error) => {
    console.warn('Failed to clean up expired CLI API-key handoffs.', error)
  })

  ipcMain.handle('app:consumeApiKeyHandoff', async (_event, token: unknown) => {
    if (typeof token !== 'string') return null
    return consumeApiKeyHandoff(token)
  })
}
