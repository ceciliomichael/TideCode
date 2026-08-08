import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../../lib/userFacingError'
import type { GitCommitResult, GitHistoryCommitDetailsResult, GitHistoryEntry } from '../../types/chat'
import { normalizeWorkspaceRootPathForComparison } from '../../lib/workspaceRootPathComparison'
import { useGitSourceControlWatcher } from '../../hooks/useGitSourceControlWatcher'
import { computeSwimlanes } from './historyGraphLayout'
import { prependCommittedHistoryEntry } from './sourceControlHistoryUtils'

const HISTORY_PAGE_SIZE = 200
const HISTORY_REFRESH_INTERVAL_MS = 5000

interface UseSourceControlHistoryInput {
  hasRepository: boolean
  isOpen: boolean
  normalizedWorkspacePath: string
}

export function useSourceControlHistory({
  hasRepository,
  isOpen,
  normalizedWorkspacePath,
}: UseSourceControlHistoryInput) {
  useGitSourceControlWatcher(normalizedWorkspacePath)
  const historyRowRefMap = useRef(new Map<string, HTMLButtonElement | null>())
  const headHashRef = useRef<string | null>(null)
  const [historyEntries, setHistoryEntries] = useState<GitHistoryEntry[]>([])
  const [headHash, setHeadHash] = useState<string | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<string[]>([])
  const [commitDetailsByHash, setCommitDetailsByHash] =
    useState<Record<string, GitHistoryCommitDetailsResult>>({})
  const [loadingCommitHashes, setLoadingCommitHashes] = useState<string[]>([])
  const historyRequestIdRef = useRef(0)
  const hasWorkspacePath = normalizedWorkspacePath.length > 0
  const historyViewModels = useMemo(() => computeSwimlanes(historyEntries), [historyEntries])

  const loadHistoryPage = useCallback(
    async (offset: number, append: boolean, options?: { skipIfHeadUnchanged?: boolean }) => {
      if (!hasWorkspacePath) return
      const requestId = historyRequestIdRef.current + 1
      historyRequestIdRef.current = requestId
      const result = await window.tidecodeGit.getHistoryPage({
        limit: HISTORY_PAGE_SIZE,
        offset,
        workspacePath: normalizedWorkspacePath,
      })
      if (requestId !== historyRequestIdRef.current) {
        return
      }

      if (!append && options?.skipIfHeadUnchanged && result.headHash === headHashRef.current) {
        return
      }
      headHashRef.current = result.headHash
      setHeadHash(result.headHash)
      setHasMoreHistory(result.hasMore)
      setHistoryEntries((currentEntries) =>
        append ? [...currentEntries, ...result.entries] : result.entries,
      )
      setSelectedCommitHash((currentSelectedHash) => {
        if (currentSelectedHash && result.entries.some((entry) => entry.hash === currentSelectedHash)) {
          return currentSelectedHash
        }
        if (result.headHash && result.entries.some((entry) => entry.hash === result.headHash)) {
          return result.headHash
        }
        return result.entries[0]?.hash ?? null
      })
    },
    [hasWorkspacePath, normalizedWorkspacePath],
  )

  const refreshHistory = useCallback(async (options?: { silent?: boolean; skipIfHeadUnchanged?: boolean }) => {
    if (!hasWorkspacePath || !hasRepository) {
      historyRequestIdRef.current += 1
      setHistoryEntries([])
      headHashRef.current = null
      setHeadHash(null)
      setHasMoreHistory(false)
      setHistoryError(null)
      setSelectedCommitHash(null)
      setExpandedCommitHashes([])
      setCommitDetailsByHash({})
      setLoadingCommitHashes([])
      return
    }
    setHistoryError(null)
    if (!options?.silent) setIsLoadingHistory(true)
    try {
      await loadHistoryPage(0, false, { skipIfHeadUnchanged: options?.skipIfHeadUnchanged })
    } catch (error) {
      if (!options?.silent) {
        setHistoryEntries([])
        setHeadHash(null)
        setHasMoreHistory(false)
      }
      setHistoryError(toUserFacingErrorMessage(error, 'The Git history could not be loaded.'))
    } finally {
      if (!options?.silent) setIsLoadingHistory(false)
    }
  }, [hasRepository, hasWorkspacePath, loadHistoryPage])

  const appendCommittedHistoryEntry = useCallback(async (commitResult: GitCommitResult) => {
    if (!hasWorkspacePath) return false
    const nextEntry = commitResult.historyEntry
    if (nextEntry) {
      setHistoryEntries((currentValue) => prependCommittedHistoryEntry(currentValue, nextEntry))
      headHashRef.current = nextEntry.hash
      setHeadHash(nextEntry.hash)
      setSelectedCommitHash(nextEntry.hash)
      setHistoryError(null)
      return true
    }
    try {
      const result = await window.tidecodeGit.getHistoryPage({
        limit: 1,
        offset: 0,
        workspacePath: normalizedWorkspacePath,
      })
      const latestEntry = result.entries[0]
      if (!latestEntry || latestEntry.hash !== commitResult.commitHash) return false
      setHistoryEntries((currentValue) => prependCommittedHistoryEntry(currentValue, latestEntry))
      headHashRef.current = result.headHash
      setHeadHash(result.headHash)
      setSelectedCommitHash(latestEntry.hash)
      setHistoryError(null)
      return true
    } catch (error) {
      console.error('Failed to append the latest commit to the source control history.', error)
      return false
    }
  }, [hasWorkspacePath, normalizedWorkspacePath])

  const loadMoreHistory = useCallback(async () => {
    if (!hasWorkspacePath || !hasMoreHistory || isLoadingMoreHistory) return
    setIsLoadingMoreHistory(true)
    setHistoryError(null)
    try {
      await loadHistoryPage(historyEntries.length, true)
    } catch (error) {
      setHistoryError(toUserFacingErrorMessage(error, 'More Git history could not be loaded.'))
    } finally {
      setIsLoadingMoreHistory(false)
    }
  }, [hasMoreHistory, hasWorkspacePath, historyEntries.length, isLoadingMoreHistory, loadHistoryPage])

  const loadCommitDetails = useCallback(async (commitHash: string) => {
    if (!hasWorkspacePath || commitDetailsByHash[commitHash] || loadingCommitHashes.includes(commitHash)) return
    setLoadingCommitHashes((currentValue) => [...currentValue, commitHash])
    try {
      const details = await window.tidecodeGit.getHistoryCommitDetails({
        commitHash,
        workspacePath: normalizedWorkspacePath,
      })
      setCommitDetailsByHash((currentValue) => ({ ...currentValue, [commitHash]: details }))
    } catch (error) {
      setHistoryError(toUserFacingErrorMessage(error, 'The commit details could not be loaded.'))
    } finally {
      setLoadingCommitHashes((currentValue) => currentValue.filter((value) => value !== commitHash))
    }
  }, [commitDetailsByHash, hasWorkspacePath, loadingCommitHashes, normalizedWorkspacePath])

  const handleGoToCurrentCommit = useCallback(async () => {
    if (!headHash) return
    if (!historyEntries.some((entry) => entry.hash === headHash) && hasMoreHistory) {
      await loadMoreHistory()
    }
    setSelectedCommitHash(headHash)
    requestAnimationFrame(() => {
      historyRowRefMap.current.get(headHash)?.scrollIntoView({ block: 'center' })
    })
  }, [hasMoreHistory, headHash, historyEntries, loadMoreHistory])

  const handleCommitExpandedToggle = useCallback((commitHash: string) => {
    const shouldExpand = !expandedCommitHashes.includes(commitHash)
    setSelectedCommitHash(commitHash)
    setExpandedCommitHashes((currentValue) =>
      shouldExpand ? [...currentValue, commitHash] : currentValue.filter((value) => value !== commitHash),
    )
    if (shouldExpand) void loadCommitDetails(commitHash)
  }, [expandedCommitHashes, loadCommitDetails])

  useEffect(() => {
    if (hasRepository || !hasWorkspacePath) {
      void refreshHistory()
    }
  }, [hasRepository, hasWorkspacePath, normalizedWorkspacePath, refreshHistory])

  useEffect(() => {
    if (!hasWorkspacePath) {
      return
    }

    const comparableWorkspacePath = normalizeWorkspaceRootPathForComparison(normalizedWorkspacePath)
    const unsubscribe = window.tidecodeGit.onSourceControlChange((event) => {
      if (normalizeWorkspaceRootPathForComparison(event.workspacePath) !== comparableWorkspacePath) {
        return
      }

      void refreshHistory({ silent: true, skipIfHeadUnchanged: true })
    })

    return () => {
      unsubscribe()
    }
  }, [hasWorkspacePath, normalizedWorkspacePath, refreshHistory])

  useEffect(() => {
    const handleFocus = () => {
      if (isOpen && hasRepository) void refreshHistory({ silent: true, skipIfHeadUnchanged: true })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [hasRepository, isOpen, refreshHistory])

  useEffect(() => {
    if (!isOpen || !hasRepository || !hasWorkspacePath) {
      return
    }

    void refreshHistory({ silent: true, skipIfHeadUnchanged: true })

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshHistory({ silent: true, skipIfHeadUnchanged: true })
      }
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return
      }

      void refreshHistory({ silent: true, skipIfHeadUnchanged: true })
    }, HISTORY_REFRESH_INTERVAL_MS)

    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [hasRepository, hasWorkspacePath, isOpen, refreshHistory])

  return {
    appendCommittedHistoryEntry,
    commitDetailsByHash,
    expandedCommitHashes,
    handleCommitExpandedToggle,
    handleGoToCurrentCommit,
    hasMoreHistory,
    headHash,
    historyEntries,
    historyError,
    historyRowRefMap,
    historyViewModels,
    isLoadingHistory,
    isLoadingMoreHistory,
    loadCommitDetails,
    loadMoreHistory,
    loadingCommitHashes,
    refreshHistory,
    selectedCommitHash,
  }
}
