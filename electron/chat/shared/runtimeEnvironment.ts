import type { ChatRuntimeEnvironmentSnapshot } from '../../../src/types/chat'
import { detectVenvInfo } from '../../python/venv'
import { resolvePreferredTerminalShell } from '../../terminal/configuration'

export function resolveChatRuntimeEnvironment(workspaceRootPath: string): ChatRuntimeEnvironmentSnapshot {
  const terminalShell = resolvePreferredTerminalShell()
  const pythonVenv = detectVenvInfo(workspaceRootPath)

  return {
    pythonVenv: pythonVenv
      ? {
          name: pythonVenv.name,
          relativePath: pythonVenv.relativePath,
        }
      : null,
    terminalShell: terminalShell
      ? {
          command: terminalShell.command,
          label: terminalShell.label,
        }
      : null,
  }
}
