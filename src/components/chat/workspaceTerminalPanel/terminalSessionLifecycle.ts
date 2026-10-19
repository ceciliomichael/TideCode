import type { CreateTerminalSessionInput, CreateTerminalSessionResult, CloseTerminalSessionInput } from '../../../types/chat'
import type { TerminalTabState } from './workspaceTerminalPanelTypes'
import { getErrorMessage, isTerminalSessionUnavailable, isTerminalTransportDisconnected } from './workspaceTerminalPanelUtils'

interface TerminalSessionLifecycleOptions {
  tab: TerminalTabState
  sessionKey: string
  api: {
    closeSession: (input: CloseTerminalSessionInput) => Promise<void>
    createSession: (input: CreateTerminalSessionInput) => Promise<CreateTerminalSessionResult>
  }
  isCurrent: () => boolean
  prepareTerminal: () => { cols: number; rows: number }
  onReady: (session: CreateTerminalSessionResult) => void
  onError: (error: unknown) => void
}

// Both opening and restarting use the same failure boundary, including local
// xterm setup. A stale completion releases only the session that it created.
export async function startTerminalSession({ tab, sessionKey, api, isCurrent, prepareTerminal, onReady, onError }: TerminalSessionLifecycleOptions) {
  try {
    if (tab.sessionId !== null) {
      try {
        await api.closeSession({
          brokerSessionId: tab.brokerSessionId ?? undefined,
          sessionId: tab.sessionId,
          workspaceRootPath: tab.workspaceRootPath,
        })
      } catch (error) {
        const message = getErrorMessage(error)
        if (!isTerminalSessionUnavailable(message) && !isTerminalTransportDisconnected(message)) {
          throw error
        }
      }
    }
    if (!isCurrent()) {
      return
    }
    const dimensions = prepareTerminal()
    const session = await api.createSession({
      ...dimensions,
      cwd: tab.workspaceRootPath,
      workspaceRootPath: tab.workspaceRootPath,
      sessionKey,
    })
    if (!isCurrent()) {
      await api.closeSession({
        brokerSessionId: session.brokerSessionId,
        sessionId: session.sessionId,
        workspaceRootPath: session.workspaceRootPath,
      })
      return
    }
    onReady(session)
  } catch (error) {
    if (isCurrent()) {
      onError(error)
    }
  }
}
