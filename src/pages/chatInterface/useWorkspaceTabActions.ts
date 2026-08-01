import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { WorkspaceFileTab, WorkspaceTab } from '../../components/workspaceExplorer/types'
import { createMarkdownPreviewTabKey, isMarkdownPreviewablePath } from '../../lib/markdown-preview'
import { getPathBasename } from '../../lib/pathPresentation'
import { createSvgPreviewTabKey, isSvgPreviewablePath } from '../../lib/svg-preview'

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
  const handleOpenWorkspaceFile = useCallback(
    (relativePath: string) => {
      const workspaceRootPath = activeWorkspacePathRef.current
      if (!workspaceRootPath) return

      if (activeWorkspacePanelWidth !== null) {
        setWorkspaceExplorerWidth(activeWorkspacePanelWidth)
      }
      setIsSidebarOpen(false)
      setIsExplorerOpen(true)
      setIsWorkspaceTabsPanelVisible(true)
      onRightPanelOpenChange(false)
      setActiveWorkspaceFilePath(relativePath)
      setActiveWorkspaceTabKey(relativePath)
      setWorkspaceFileTabs((currentTabs) => {
        if (currentTabs.some((tab) => tab.kind === 'file' && tab.relativePath === relativePath)) {
          return currentTabs
        }

        return [
          ...currentTabs,
          {
            kind: 'file',
            content: '',
            originalContent: null,
            fileName: getPathBasename(relativePath),
            isBinary: false,
            isTruncated: false,
            relativePath,
            tabKey: relativePath,
            sizeBytes: 0,
            status: 'loading',
          },
        ]
      })

      void window.tidecodeWorkspace
        .readFile({ relativePath, workspaceRootPath })
        .then((result) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) return

          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) => {
              if (tab.kind !== 'file' || tab.relativePath !== relativePath) return tab

              const normalizedContent = result.content.replace(/\r\n/g, '\n')
              return {
                ...tab,
                content: normalizedContent,
                originalContent: normalizedContent,
                fileName: getPathBasename(result.relativePath),
                isBinary: result.isBinary,
                isTruncated: result.isTruncated,
                relativePath: result.relativePath,
                tabKey: result.relativePath,
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
              tab.kind === 'file' && tab.relativePath === relativePath
                ? {
                    ...tab,
                    errorMessage: error instanceof Error ? error.message : 'Failed to open file.',
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
      setIsSidebarOpen(false)
      setIsExplorerOpen(true)
      setIsWorkspaceTabsPanelVisible(true)
      onRightPanelOpenChange(false)
      setActiveWorkspaceFilePath(relativePath)
      setActiveWorkspaceTabKey(tabKey)

      setWorkspaceFileTabs((currentTabs) => {
        if (currentTabs.some((tab) => tab.tabKey === tabKey)) return currentTabs

        const newTab =
          kind === 'markdown-preview'
            ? {
                kind,
                fileName: getPathBasename(relativePath),
                relativePath,
                tabKey,
                content: initialContent,
                status: initialStatus,
                isTruncated: false,
              }
            : { kind, fileName: getPathBasename(relativePath), relativePath, tabKey }

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
      if (!isMarkdownPreviewablePath(relativePath)) return

      const workspaceRootPath = activeWorkspacePathRef.current
      const tabKey = createMarkdownPreviewTabKey(relativePath)
      const sourceTab = workspaceFileTabsRef.current.find(
        (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.relativePath === relativePath,
      )
      const initialContent = sourceTab?.content ?? ''
      const initialStatus = sourceTab?.status === 'ready' ? ('ready' as const) : ('loading' as const)

      openWorkspacePreviewTab(relativePath, tabKey, 'markdown-preview', initialContent, initialStatus)
      if (!workspaceRootPath) return

      void window.tidecodeWorkspace
        .readFile({ relativePath, workspaceRootPath })
        .then((result) => {
          if (activeWorkspacePathRef.current !== workspaceRootPath) return
          const normalizedContent = result.content.replace(/\r\n/g, '\n')
          setWorkspaceFileTabs((currentTabs) =>
            currentTabs.map((tab) =>
              tab.kind === 'markdown-preview' && tab.tabKey === tabKey
                ? {
                    ...tab,
                    content: normalizedContent,
                    status: 'ready' as const,
                    isTruncated: result.isTruncated,
                    fileName: getPathBasename(result.relativePath),
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
                    errorMessage: error instanceof Error ? error.message : 'Failed to load file.',
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
      if (isSvgPreviewablePath(relativePath)) {
        openWorkspacePreviewTab(relativePath, createSvgPreviewTabKey(relativePath), 'svg-preview')
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
    handleOpenWorkspaceSvgPreview,
    handleSelectWorkspaceTab,
  }
}
