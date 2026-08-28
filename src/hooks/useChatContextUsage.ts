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
  toolSchemaTokens: 0,
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
    let liveStreamId: string | null = null
    const pendingCompactionRefreshes = new Set<number>()

    const fetchUsage = (force = false) => {
      if (liveStreamId && !force) return
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
    const unsubscribeChat = window.tidecodeChat.onStreamEvent((event) => {
      if (event.type === 'context_usage_updated' && event.conversationId === conversationId) {
        liveStreamId = event.streamId
        requestSequenceRef.current += 1
        setUsage(event.usage)
        return
      }

      if (event.type === 'compaction_committed' && event.conversationId === conversationId) {
        if (liveStreamId === event.streamId) return
        refreshAfterCompaction()
        return
      }

      const isRelevantCompletion =
        (event.type === 'completed' || event.type === 'aborted' || event.type === 'error') &&
        event.conversationId === conversationId
      if (!isRelevantCompletion) return
      if (liveStreamId && liveStreamId !== event.streamId) return

      liveStreamId = null
      fetchUsage(true)
    })

    void window.tidecodeRuns.listActiveRuns()
      .then((runs) => {
        if (isCancelled || liveStreamId || !conversationId) return
        const activeRun = runs.find((run) => run.conversationId === conversationId)
        if (activeRun?.streamId && activeRun.contextUsage) {
          liveStreamId = activeRun.streamId
          requestSequenceRef.current += 1
          setUsage(activeRun.contextUsage)
          return
        }
        fetchUsage()
      })
      .catch(() => {
        if (!isCancelled) fetchUsage()
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
