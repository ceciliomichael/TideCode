import { useEffect, useMemo, useRef, useState } from 'react'
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
  imageTokens: 0,
  scope: 'reconstructed_preview',
  countingMethod: 'heuristic',
  historyTokens: 0,
  injectionTokens: 0,
  maxTokens: 200_000,
  systemPromptTokens: 0,
  toolSchemaTokens: 0,
  toolResultsTokens: 0,
  totalTokens: 0,
}
const CONTEXT_USAGE_FALLBACK_INTERVAL_MS = 60_000

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

export function createContextUsageRefresh() {
  let active = false
  let pending: (() => Promise<void>) | null = null
  const drain = async () => {
    if (active) {
      return
    }
    active = true
    try {
      while (pending) {
        const task = pending
        pending = null
        await task()
      }
    } finally {
      active = false
    }
  }
  return {
    request: (task: () => Promise<void>) => {
      pending = task
      void drain().catch((error) => console.error('Failed to refresh context usage', error))
    },
    cancelPending: () => { pending = null },
  }
}

export function useChatContextUsage({
  agentContextRootPath,
  chatMode,
  conversationId,
  contextCompaction: contextCompactionInput,
  messages,
  modelId,
  providerId,
  refreshSignal = 0,
  terminalExecutionMode,
}: UseChatContextUsageInput) {
  const { contextWindowTokens, retainedContextTokens, triggerPercent } = contextCompactionInput
  const contextCompaction = useMemo(() => ({
    contextWindowTokens,
    retainedContextTokens,
    triggerPercent,
  }), [contextWindowTokens, retainedContextTokens, triggerPercent])

  // A new selection owns its queue so an old chat's request cannot delay it.
  const refreshQueue = useMemo(createContextUsageRefresh, [
    agentContextRootPath,
    chatMode,
    contextCompaction,
    conversationId,
    modelId,
    providerId,
    terminalExecutionMode,
  ])
  const [usageState, setUsageState] = useState({
    owner: refreshQueue,
    usage: EMPTY_CONTEXT_USAGE,
  })
  const messagesRef = useRef(messages)
  const fetchUsageRef = useRef<(() => void) | null>(null)
  const requestSequenceRef = useRef(0)
  messagesRef.current = messages

  useEffect(() => {
    const setUsage = (usage: ContextUsageEstimate) => {
      setUsageState({ owner: refreshQueue, usage })
    }

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
      refreshQueue.request(async () => {
        if (isCancelled || (liveStreamId && !force)) {
          return
        }
        // Queuing another refresh must not discard a usable in-flight result.
        // Advance the sequence only when the next estimate actually starts.
        const requestSequence = ++requestSequenceRef.current
        await window.tidecodeChat
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
        if ((event.usage.providerId && event.usage.providerId !== providerId)
          || (event.usage.modelId && event.usage.modelId !== modelId)) {
          return
        }
        liveStreamId = event.streamId
        refreshQueue.cancelPending()
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

    // Estimate immediately; active-run discovery may supply a newer live value.
    fetchUsage()
    void window.tidecodeRuns.listActiveRuns()
      .then((runs) => {
        if (isCancelled || liveStreamId || !conversationId) return
        const activeRun = runs.find((run) => run.conversationId === conversationId)
        if (activeRun?.streamId && activeRun.contextUsage) {
          if ((activeRun.contextUsage.providerId && activeRun.contextUsage.providerId !== providerId)
            || (activeRun.contextUsage.modelId && activeRun.contextUsage.modelId !== modelId)) {
            return
          }
          liveStreamId = activeRun.streamId
          refreshQueue.cancelPending()
          requestSequenceRef.current += 1
          setUsage(activeRun.contextUsage)
          return
        }
      })
      .catch((error) => {
        console.error('Failed to restore live chat context usage', error)
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

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchUsage()
      }
    }, CONTEXT_USAGE_FALLBACK_INTERVAL_MS)
    const handleFocus = () => fetchUsage()
    window.addEventListener('focus', handleFocus)

    return () => {
      isCancelled = true
      refreshQueue.cancelPending()
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
  }, [agentContextRootPath, chatMode, contextCompaction, conversationId, modelId, providerId, refreshQueue, refreshSignal, terminalExecutionMode])

  useEffect(() => {
    if (!providerId) return
    const timeoutId = window.setTimeout(() => fetchUsageRef.current?.(), 250)
    return () => window.clearTimeout(timeoutId)
  }, [messages, providerId, refreshSignal])

  // Hide the previous selection's numbers during the render that switches chats,
  // rather than waiting for an effect or an asynchronous estimate to reset them.
  return providerId && usageState.owner === refreshQueue ? usageState.usage : EMPTY_CONTEXT_USAGE
}
