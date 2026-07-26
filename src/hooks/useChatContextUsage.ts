import { useEffect, useMemo, useState } from 'react'
import { estimateMessageContextUsage } from '../lib/contextUsage'
import type {
  AppTerminalExecutionMode,
  ChatMode,
  ChatProviderId,
  ContextUsageEstimate,
  Message,
} from '../types/chat'

const EMPTY_CONTEXT_USAGE: ContextUsageEstimate = {
  historyTokens: 0,
  maxTokens: 200_000,
  systemPromptTokens: 0,
  toolResultsTokens: 0,
  totalTokens: 0,
}

interface UseChatContextUsageInput {
  agentContextRootPath: string | null
  chatMode: ChatMode
  messages: Message[]
  providerId: ChatProviderId | null
  terminalExecutionMode: AppTerminalExecutionMode
}

export function useChatContextUsage({
  agentContextRootPath,
  chatMode,
  messages,
  providerId,
  terminalExecutionMode,
}: UseChatContextUsageInput) {
  const [staticUsage, setStaticUsage] = useState<ContextUsageEstimate>(EMPTY_CONTEXT_USAGE)

  useEffect(() => {
    if (!providerId) {
      setStaticUsage(EMPTY_CONTEXT_USAGE)
      return
    }

    let isCancelled = false

    const fetchUsage = () => {
      void window.echosphereChat
        .estimateContextUsage({
          agentContextRootPath,
          chatMode,
          messages: [],
          providerId,
          terminalExecutionMode,
        })
        .then((nextUsage) => {
          if (!isCancelled) {
            setStaticUsage(nextUsage)
          }
        })
        .catch((error) => {
          console.error('Failed to estimate chat context usage', error)
        })
    }

    // Initial fetch
    const timeoutId = window.setTimeout(fetchUsage, 120)

    // 1. Real-Time File Change Detection via Electron chokidar watcher
    let unsubscribeExplorer: (() => void) | null = null
    if (agentContextRootPath?.trim()) {
      const rootPath = agentContextRootPath.trim()
      unsubscribeExplorer = window.echosphereWorkspace.onExplorerChange((event) => {
        if (event.workspaceRootPath === rootPath) {
          fetchUsage()
        }
      })
      void window.echosphereWorkspace.watchExplorerChanges({ workspaceRootPath: rootPath })
    }

    // 2. Low-frequency safety poll (every 10s fallback for external edits)
    const intervalId = window.setInterval(fetchUsage, 10_000)

    // 3. Immediate refresh on window focus
    const handleFocus = () => fetchUsage()
    window.addEventListener('focus', handleFocus)

    return () => {
      isCancelled = true
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)

      if (unsubscribeExplorer) {
        unsubscribeExplorer()
      }
      if (agentContextRootPath?.trim()) {
        void window.echosphereWorkspace.unwatchExplorerChanges({
          workspaceRootPath: agentContextRootPath.trim(),
        })
      }
    }
  }, [agentContextRootPath, chatMode, providerId, terminalExecutionMode])

  return useMemo(() => {
    const messageUsage = estimateMessageContextUsage(messages)
    return {
      ...staticUsage,
      historyTokens: messageUsage.historyTokens,
      toolResultsTokens: messageUsage.toolResultsTokens,
      totalTokens: staticUsage.systemPromptTokens + messageUsage.totalTokens,
    }
  }, [messages, staticUsage])
}
