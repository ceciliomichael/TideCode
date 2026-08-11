import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { WorkspaceFileTab, WorkspaceTab } from '../../components/workspaceExplorer/types'
import { toUserFacingErrorMessage } from '../../lib/userFacingError'
import { createMarkdownPreviewTabKey, isMarkdownPreviewablePath } from '../../lib/markdown-preview'
import { normalizePathSeparators } from '../../lib/filePathUtils'
import { getPathBasename } from '../../lib/pathPresentation'
import {
  createPlanPreviewTabKey,
  extractPlanTitle,
  getPlanIdFromRelativePath,
  isPlanRelativePath,
  setPlanStatus,
} from '../../lib/planContracts'
import { createSvgPreviewTabKey, isSvgPreviewablePath } from '../../lib/svg-preview'
import { readWorkspaceFileWithCache } from '../../lib/workspaceFilePreviewCache'
import { preloadWorkspaceMonacoEditorView } from '../../lib/workspaceMonacoPreload'

interface UseWorkspaceTabActionsInput {
  activeWorkspacePanelWidth: number | null
  activeWorkspacePathRef: MutableRefObject<string | null>
  onRightPanelOpenChange: (nextValue: boolean) => void
  setActiveWorkspaceFilePath: Dispatch<SetStateAction<string | null>>
  setActiveWorkspaceTabKey: Dispatch<SetStateAction<string | null>>
  setIsExplorerOpen: Dispatch<SetStateAction<boolean>>
  setIsSidebarOpen: (nextValue: boolean) => void
  setIsWorkspaceTabsPanelVisible: Dispatch<SetStateAction<boolean>>
  setWorkspaceExplorerWidth: Dispatch<SetStateAction<number>>
  setWorkspaceFileTabs: Dispatch<SetStateAction<WorkspaceTab[]>>
  workspaceAutosaveTimeoutsRef: MutableRefObject<Map<string, number>>
  workspaceFileTabs: WorkspaceTab[]
  workspaceFileTabsRef: MutableRefObject<WorkspaceTab[]>
}

export function useWorkspaceTabActions({
  activeWorkspacePanelWidth,
  activeWorkspacePathRef,
  onRightPanelOpenChange,
  setActiveWorkspaceFilePath,
  setActiveWorkspaceTabKey,
  setIsExplorerOpen,
  setIsSidebarOpen,
  setIsWorkspaceTabsPanelVisible,
  setWorkspaceExplorerWidth,
  setWorkspaceFileTabs,
  workspaceAutosaveTimeoutsRef,
  workspaceFileTabs,
  workspaceFileTabsRef,
}: UseWorkspaceTabActionsInput) {
  const openWorkspacePlanPreviewTab = useCallback(
    (
      relativePath: string,
      initialContent = '',
      initialStatus: 'loading' | 'ready' = 'loading',
    ) => {
      const normalizedRelativePath = normalizePathSeparators(relativePath)
      const planId = getPlanIdFromRelativePath(normalizedRelativePath)
      if (!planId) {
        return null
      }

      const tabKey = createPlanPreviewTabKey(normalizedRelativePath)
      if (activeWorkspacePanelWidth !== null) {
        setWorkspaceExplorerWidth(activeWorkspacePanelWidth)
      }
      setIsSidebarOpen(false)
      setIsExplorerOpen(true)
      setIsWorkspaceTabsPanelVisible(true)
      onRightPanelOpenChange(false)
      setActiveWorkspaceFilePath(normalizedRelativePath)
      setActiveWorkspaceTabKey(tabKey)
      setWorkspaceFileTabs((currentTabs) => {
        if (currentTabs.some((tab) => tab.tabKey === tabKey)) {
          return currentTabs
        }

        return [
          ...currentTabs,
          {
            kind: 'plan-preview',
            content: initialContent,
            fileName: getPathBasename(normalizedRelativePath),
            isTruncated: false,
            planId,
            relativePath: normalizedRelativePath,
            status: initialStatus,
            tabKey,
            title: extractPlanTitle(initialContent),
          },
        ]
      })

      return { normalizedRelativePath, tabKey }
    },
    [
      activeWorkspacePanelWidth,
      onRightPanelOpenChange,
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsExplorerOpen,
      setIsSidebarOpen,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceExplorerWidth,
      setWorkspaceFileTabs,
    ],
  )

  const handleOpenWorkspacePlanPreview = useCallback(
    async (relativePath: string): Promise<void> => {
      const normalizedRelativePath = normalizePathSeparators(relativePath)
      if (!isPlanRelativePath(normalizedRelativePath)) {
        return
      }

      const workspaceRootPath = activeWorkspacePathRef.current
      const existingTab = workspaceFileTabsRef.current.find(
        (tab) => tab.kind === 'plan-preview' && normalizePathSeparators(tab.relativePath) === normalizedRelativePath,
      )
      const openedTab = openWorkspacePlanPreviewTab(
        normalizedRelativePath,
        existingTab?.kind === 'plan-preview' ? existingTab.content : '',
        existingTab?.kind === 'plan-preview' && existingTab.status === 'ready' ? 'ready' : 'loading',
      )
      if (!openedTab || !workspaceRootPath) {
        return
      }

      try {
        const result = await window.tidecodeWorkspace.readFile({
          relativePath: normalizedRelativePath,
          workspaceRootPath,
        })
        if (result.status === 'missing') {
          throw new Error(`File does not exist: ${result.relativePath}`)
        }
        if (activeWorkspacePathRef.current !== workspaceRootPath) {
          return
        }

        const normalizedContent = result.content.replace(/\r\n?/gu, '\n')
        const normalizedResultPath = normalizePathSeparators(result.relativePath)
        setWorkspaceFileTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.kind === 'plan-preview' && tab.tabKey === openedTab.tabKey
              ? {
                  ...tab,
                  content: normalizedContent,
                  errorMessage: undefined,
                  fileName: getPathBasename(normalizedResultPath),
                  isTruncated: result.isTruncated,
                  planId: getPlanIdFromRelativePath(normalizedResultPath) ?? tab.planId,
                  relativePath: normalizedResultPath,
                  status: 'ready' as const,
                  title: extractPlanTitle(normalizedContent),
                }
              : tab,
          ),
        )
      } catch (error) {
        if (activeWorkspacePathRef.current !== workspaceRootPath) {
          return
        }

        setWorkspaceFileTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.kind === 'plan-preview' && tab.tabKey === openedTab.tabKey
              ? {
                  ...tab,
                  errorMessage: toUserFacingErrorMessage(error, 'The plan could not be loaded.'),
                  status: 'error' as const,
                }
              : tab,
          ),
        )
      }
    },
    [
      activeWorkspacePathRef,
      openWorkspacePlanPreviewTab,
      setWorkspaceFileTabs,
      workspaceFileTabsRef,
    ],
  )

  const handleMarkWorkspacePlanImplementationStarted = useCallback(
    async (relativePath: string) => {
      const normalizedRelativePath = normalizePathSeparators(relativePath)
      const workspaceRootPath = activeWorkspacePathRef.current
      if (!workspaceRootPath || !isPlanRelativePath(normalizedRelativePath)) {
        return false
      }

      const result = await window.tidecodeWorkspace.readFile({
        relativePath: normalizedRelativePath,
        workspaceRootPath,
      })
      if (result.status === 'missing') {
        throw new Error(`File does not exist: ${result.relativePath}`)
      }
      const normalizedContent = result.content.replace(/\r\n?/gu, '\n')
      const nextContent = setPlanStatus(normalizedContent, 'implementation_started')
      if (nextContent !== normalizedContent) {
        await window.tidecodeWorkspace.writeFile({
          content: nextContent,
          relativePath: normalizedRelativePath,
          workspaceRootPath,
        })
      }

      const normalizedResultPath = normalizePathSeparators(result.relativePath)
      setWorkspaceFileTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.kind === 'plan-preview' && normalizePathSeparators(tab.relativePath) === normalizedRelativePath
            ? {
                ...tab,
                content: nextContent,
                errorMessage: undefined,
                isTruncated: result.isTruncated,
                relativePath: normalizedResultPath,
                status: 'ready',
                title: extractPlanTitle(nextContent),
              }
            : tab,
        ),
      )

      return true
    },
    [activeWorkspacePathRef, setWorkspaceFileTabs],
  )

  const handleOpenWorkspaceFile = useCallback(
    (relativePath: string) => {
      const workspaceRootPath = activeWorkspacePathRef.current
      if (!workspaceRootPath) return

      const normalizedRelativePath = normalizePathSeparators(relativePath)

      if (isPlanRelativePath(normalizedRelativePath)) {
        handleOpenWorkspacePlanPreview(normalizedRelativePath)
        return
      }

      if (activeWorkspacePanelWidth !== null) {
        setWorkspaceExplorerWidth(activeWorkspacePanelWidth)
      }
      setIsSidebarOpen(false)
      setIsExplorerOpen(true)
      setIsWorkspaceTabsPanelVisible(true)
      onRightPanelOpenChange(false)
      setActiveWorkspaceFilePath(normalizedRelativePath)
      setActiveWorkspaceTabKey(normalizedRelativePath)
      void preloadWorkspaceMonacoEditorView().catch(() => undefined)
      setWorkspaceFileTabs((currentTabs) => {
        if (
          currentTabs.some(
            (tab) => tab.kind === 'file' && normalizePathSeparators(tab.relativePath) === normalizedRelativePath,
          )
        ) {
          return currentTabs
        }

        return [
          ...currentTabs,
          {
            kind: 'file',
            content: '',
            originalContent: null,
            fileName: getPathBasename(normalizedRelativePath),
            isBinary: false,
            isTruncated: false,
            modifiedTimeMs: 0,
            relativePath: normalizedRelativePath,
            tabKey: normalizedRelativePath,
            sizeBytes: 0,
            status: 'loading',
          },
        ]
      })

      void readWorkspaceFileWithCache(
        { relativePath: normalizedRelativePath, workspaceRootPath },
        { consume: true, priority: true },
      )
        .then((result) => {
          if (result.status === 'missing') {
            throw new Error(`File does not exist: ${result.relativePath}`)
          }
          if (activeWorkspacePathRef.current !== workspaceRootPath) return

          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) => {
              if (
                tab.kind !== 'file' ||
                normalizePathSeparators(tab.relativePath) !== normalizedRelativePath
              ) {
                return tab
              }

              const normalizedContent = result.content.replace(/\r\n/g, '\n')
              const normalizedResultPath = normalizePathSeparators(result.relativePath)
              return {
                ...tab,
                content: normalizedContent,
                originalContent: normalizedContent,
                fileName: getPathBasename(normalizedResultPath),
                isBinary: result.isBinary,
                isTruncated: result.isTruncated,
                modifiedTimeMs: result.modifiedTimeMs,
                previewDataUrl: result.previewDataUrl,
                previewError: result.previewError,
                previewMimeType: result.previewMimeType,
                relativePath: normalizedResultPath,
                tabKey: normalizedResultPath,
                sizeBytes: result.sizeBytes,
                status: 'ready',
              }
            }),
          )
        })
        .catch((error) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) return

          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === 'file' && normalizePathSeparators(tab.relativePath) === normalizedRelativePath
                ? {
                    ...tab,
                    errorMessage: toUserFacingErrorMessage(error, 'The file could not be opened.'),
                    status: 'error',
                  }
                : tab,
            ),
          )
        })
    },
    [
      activeWorkspacePanelWidth,
      activeWorkspacePathRef,
      handleOpenWorkspacePlanPreview,
      onRightPanelOpenChange,
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsExplorerOpen,
      setIsSidebarOpen,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceExplorerWidth,
      setWorkspaceFileTabs,
    ],
  )

  const openWorkspacePreviewTab = useCallback(
    (
      relativePath: string,
      tabKey: string,
      kind: 'markdown-preview' | 'svg-preview',
      initialContent = '',
      initialStatus: 'loading' | 'ready' = 'loading',
    ) => {
      const normalizedRelativePath = normalizePathSeparators(relativePath)
      setIsSidebarOpen(false)
      setIsExplorerOpen(true)
      setIsWorkspaceTabsPanelVisible(true)
      onRightPanelOpenChange(false)
      setActiveWorkspaceFilePath(normalizedRelativePath)
      setActiveWorkspaceTabKey(tabKey)

      setWorkspaceFileTabs((currentTabs) => {
        if (currentTabs.some((tab) => tab.tabKey === tabKey)) return currentTabs

        const newTab =
          kind === 'markdown-preview'
            ? {
                kind,
                fileName: getPathBasename(normalizedRelativePath),
                relativePath: normalizedRelativePath,
                tabKey,
                content: initialContent,
                status: initialStatus,
                isTruncated: false,
              }
            : { kind, fileName: getPathBasename(normalizedRelativePath), relativePath: normalizedRelativePath, tabKey }

        return [...currentTabs, newTab]
      })
    },
    [
      onRightPanelOpenChange,
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsExplorerOpen,
      setIsSidebarOpen,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceFileTabs,
    ],
  )

  const handleOpenWorkspaceMarkdownPreview = useCallback(
    (relativePath: string) => {
      const normalizedRelativePath = normalizePathSeparators(relativePath)
      if (!isMarkdownPreviewablePath(normalizedRelativePath)) return

      const workspaceRootPath = activeWorkspacePathRef.current
      const tabKey = createMarkdownPreviewTabKey(normalizedRelativePath)
      const sourceTab = workspaceFileTabsRef.current.find(
        (tab): tab is WorkspaceFileTab =>
          tab.kind === 'file' && normalizePathSeparators(tab.relativePath) === normalizedRelativePath,
      )
      const initialContent = sourceTab?.content ?? ''
      const initialStatus = sourceTab?.status === 'ready' ? ('ready' as const) : ('loading' as const)

      openWorkspacePreviewTab(normalizedRelativePath, tabKey, 'markdown-preview', initialContent, initialStatus)
      if (!workspaceRootPath) return

      void window.tidecodeWorkspace
        .readFile({ relativePath: normalizedRelativePath, workspaceRootPath })
        .then((result) => {
          if (result.status === 'missing') {
            throw new Error(`File does not exist: ${result.relativePath}`)
          }
          if (activeWorkspacePathRef.current !== workspaceRootPath) return
          const normalizedContent = result.content.replace(/\r\n/g, '\n')
          const normalizedResultPath = normalizePathSeparators(result.relativePath)
          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === 'markdown-preview' && tab.tabKey === tabKey
                ? {
                    ...tab,
                    content: normalizedContent,
                    status: 'ready' as const,
                    isTruncated: result.isTruncated,
                    fileName: getPathBasename(normalizedResultPath),
                  }
                : tab,
            ),
          )
        })
        .catch((error) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) return
          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === 'markdown-preview' && tab.tabKey === tabKey
                ? {
                    ...tab,
                    status: 'error' as const,
                    errorMessage: toUserFacingErrorMessage(error, 'The file could not be loaded.'),
                  }
                : tab,
            ),
          )
        })
    },
    [activeWorkspacePathRef, openWorkspacePreviewTab, setWorkspaceFileTabs, workspaceFileTabsRef],
  )

  useEffect(() => {
    function handleOpenMarkdownPreviewEvent(event: Event) {
      const { relativePath, anchor } = (event as CustomEvent<{ relativePath: string; anchor?: string }>).detail ?? {}
      if (!relativePath) return

      handleOpenWorkspaceMarkdownPreview(relativePath)
      if (!anchor) return

      window.setTimeout(() => {
        const element =
          document.getElementById(anchor) ||
          document.getElementById(decodeURIComponent(anchor)) ||
          document.getElementById(anchor.toLowerCase())
        const container = element?.closest('.workspace-markdown-preview') || element?.closest('.overflow-auto')
        if (!element || !container) return

        const containerRect = container.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const targetTop = elementRect.top - containerRect.top + container.scrollTop - 24
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
      }, 300)
    }

    function handleOpenFileEvent(event: Event) {
      const { relativePath } = (event as CustomEvent<{ relativePath: string }>).detail ?? {}
      if (relativePath) handleOpenWorkspaceFile(relativePath)
    }

    window.addEventListener('tidecode:open-markdown-preview', handleOpenMarkdownPreviewEvent)
    window.addEventListener('tidecode:open-file', handleOpenFileEvent)
    return () => {
      window.removeEventListener('tidecode:open-markdown-preview', handleOpenMarkdownPreviewEvent)
      window.removeEventListener('tidecode:open-file', handleOpenFileEvent)
    }
  }, [handleOpenWorkspaceFile, handleOpenWorkspaceMarkdownPreview])

  const handleOpenWorkspaceSvgPreview = useCallback(
    (relativePath: string) => {
      const normalizedRelativePath = normalizePathSeparators(relativePath)
      if (isSvgPreviewablePath(normalizedRelativePath)) {
        openWorkspacePreviewTab(
          normalizedRelativePath,
          createSvgPreviewTabKey(normalizedRelativePath),
          'svg-preview',
        )
      }
    },
    [openWorkspacePreviewTab],
  )

  const handleCloseWorkspaceTab = useCallback(
    (tabKey: string) => {
      const closingTab = workspaceFileTabs.find((tab) => tab.tabKey === tabKey) ?? null
      const targetPath = closingTab?.relativePath ?? tabKey
      const closingPreviewTabKeys =
        closingTab?.kind === 'file'
          ? [createMarkdownPreviewTabKey(closingTab.relativePath), createSvgPreviewTabKey(closingTab.relativePath)]
          : []

      if (closingTab?.kind === 'file') {
        const pendingAutosaveTimeout = workspaceAutosaveTimeoutsRef.current.get(targetPath)
        if (typeof pendingAutosaveTimeout === 'number') {
          window.clearTimeout(pendingAutosaveTimeout)
          workspaceAutosaveTimeoutsRef.current.delete(targetPath)
        }
      }

      setWorkspaceFileTabs((currentTabs) => {
        const closingIndex = currentTabs.findIndex((tab) => tab.tabKey === tabKey)
        if (closingIndex === -1) return currentTabs

        const nextTabs =
          closingTab?.kind === 'file'
            ? currentTabs.filter(
                (tab) =>
                  tab.tabKey !== tabKey &&
                  !(
                    (tab.kind === 'markdown-preview' || tab.kind === 'svg-preview') &&
                    tab.relativePath === closingTab.relativePath
                  ),
              )
            : currentTabs.filter((tab) => tab.tabKey !== tabKey)

        if (nextTabs.length === 0) setIsWorkspaceTabsPanelVisible(false)
        setActiveWorkspaceFilePath((currentActiveFilePath) => {
          if (!closingTab || currentActiveFilePath !== closingTab.relativePath) return currentActiveFilePath
          return (nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null)?.relativePath ?? null
        })
        setActiveWorkspaceTabKey((currentActiveTabKey) => {
          if (
            currentActiveTabKey !== tabKey &&
            (!currentActiveTabKey || !closingPreviewTabKeys.includes(currentActiveTabKey))
          ) {
            return currentActiveTabKey
          }
          return (nextTabs[closingIndex] ?? nextTabs[closingIndex - 1] ?? null)?.tabKey ?? null
        })
        return nextTabs
      })
    },
    [
      setActiveWorkspaceFilePath,
      setActiveWorkspaceTabKey,
      setIsWorkspaceTabsPanelVisible,
      setWorkspaceFileTabs,
      workspaceAutosaveTimeoutsRef,
      workspaceFileTabs,
    ],
  )

  const handleSelectWorkspaceTab = useCallback(
    (tabKey: string) => {
      const selectedTab = workspaceFileTabs.find((tab) => tab.tabKey === tabKey) ?? null
      setActiveWorkspaceFilePath(selectedTab?.relativePath ?? null)
      setActiveWorkspaceTabKey(selectedTab?.tabKey ?? tabKey)
    },
    [setActiveWorkspaceFilePath, setActiveWorkspaceTabKey, workspaceFileTabs],
  )

  return {
    handleCloseWorkspaceTab,
    handleOpenWorkspaceFile,
    handleOpenWorkspaceMarkdownPreview,
    handleMarkWorkspacePlanImplementationStarted,
    handleOpenWorkspacePlanPreview,
    handleOpenWorkspaceSvgPreview,
    handleSelectWorkspaceTab,
  }
}
