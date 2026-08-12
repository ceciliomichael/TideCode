import { useEffect, useRef, useState } from 'react'
import type {
  AppTerminalExecutionMode,
  ChatMode,
  ChatProviderId,
  ContextUsageEstimate,
  Message,
} from '../types/chat'
import type { ContextCompactionSettings } from '../lib/contextCompactionSettings'
import { normalizeWorkspaceRootPathForComparison } from '../lib/workspaceRootPathComparison'

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
  conversationId: string | null
  contextCompaction: ContextCompactionSettings
  messages: Message[]
  modelId: string
  providerId: ChatProviderId | null
  refreshSignal?: number
  terminalExecutionMode: AppTerminalExecutionMode
}

export function useChatContextUsage({
  agentContextRootPath,
  chatMode,
  conversationId,
  contextCompaction,
  messages,
  modelId,
  providerId,
  refreshSignal = 0,
  terminalExecutionMode,
}: UseChatContextUsageInput) {
  const [usage, setUsage] = useState<ContextUsageEstimate>(EMPTY_CONTEXT_USAGE)
  const messagesRef = useRef(messages)
  const fetchUsageRef = useRef<(() => void) | null>(null)
  const requestSequenceRef = useRef(0)
  messagesRef.current = messages

  useEffect(() => {
    if (!providerId) {
      requestSequenceRef.current += 1
      setUsage(EMPTY_CONTEXT_USAGE)
      fetchUsageRef.current = null
      return
    }

    let isCancelled = false
    const pendingCompactionRefreshes = new Set<number>()

    const fetchUsage = () => {
      const requestSequence = ++requestSequenceRef.current
      void window.tidecodeChat
        .estimateContextUsage({
          agentContextRootPath,
          chatMode,
          conversationId,
          contextCompaction,
          messages: messagesRef.current,
          modelId,
          providerId,
          terminalExecutionMode,
        })
        .then((nextUsage) => {
          if (!isCancelled && requestSequence === requestSequenceRef.current) {
            setUsage(nextUsage)
          }
        })
        .catch((error) => {
          console.error('Failed to estimate chat context usage', error)
        })
    }

    const refreshAfterCompaction = () => {
      fetchUsage()
      for (const delayMs of [100, 500]) {
        const timeoutId = window.setTimeout(() => {
          pendingCompactionRefreshes.delete(timeoutId)
          if (!isCancelled) {
            fetchUsage()
          }
        }, delayMs)
        pendingCompactionRefreshes.add(timeoutId)
      }
    }

    fetchUsageRef.current = fetchUsage
    const timeoutId = window.setTimeout(fetchUsage, 120)
    const unsubscribeChat = window.tidecodeChat.onStreamEvent((event) => {
      const isRelevantCompletion =
        (event.type === 'completed' || event.type === 'aborted' || event.type === 'error') &&
        event.conversationId === conversationId
      if ((event.type === 'compaction_committed' && event.conversationId === conversationId) || isRelevantCompletion) {
        if (event.type === 'compaction_committed') {
          refreshAfterCompaction()
        } else {
          fetchUsage()
        }
      }
    })

    let unsubscribeExplorer: (() => void) | null = null
    if (agentContextRootPath?.trim()) {
      const rootPath = agentContextRootPath.trim()
      const comparableRootPath = normalizeWorkspaceRootPathForComparison(rootPath)
      unsubscribeExplorer = window.tidecodeWorkspace.onExplorerChange((event) => {
        if (normalizeWorkspaceRootPathForComparison(event.workspaceRootPath) === comparableRootPath) {
          fetchUsage()
        }
      })
      void window.tidecodeWorkspace.watchExplorerChanges({ workspaceRootPath: rootPath })
    }

    const intervalId = window.setInterval(fetchUsage, 10_000)
    const handleFocus = () => fetchUsage()
    window.addEventListener('focus', handleFocus)

    return () => {
      isCancelled = true
      requestSequenceRef.current += 1
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
      for (const refreshTimeoutId of pendingCompactionRefreshes) {
        window.clearTimeout(refreshTimeoutId)
      }
      pendingCompactionRefreshes.clear()
      window.removeEventListener('focus', handleFocus)
      unsubscribeChat()

      if (unsubscribeExplorer) {
        unsubscribeExplorer()
      }
      if (agentContextRootPath?.trim()) {
        void window.tidecodeWorkspace.unwatchExplorerChanges({
          workspaceRootPath: agentContextRootPath.trim(),
        })
      }
      if (fetchUsageRef.current === fetchUsage) {
        fetchUsageRef.current = null
      }
    }
  }, [agentContextRootPath, chatMode, contextCompaction, conversationId, modelId, providerId, refreshSignal, terminalExecutionMode])

  useEffect(() => {
    if (!providerId) return
    const timeoutId = window.setTimeout(() => fetchUsageRef.current?.(), 250)
    return () => window.clearTimeout(timeoutId)
  }, [messages, providerId, refreshSignal])

  return usage
}
