import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Download,
  FileText,
  Folder,
  HardDrive,
  Home,
  Image,
  LoaderCircle,
  Music,
  Search,
  Video,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  FolderPickerDirectory,
  FolderPickerEntry,
  FolderPickerRoot,
  FolderPickerRootKind,
} from '../../types/chat'
import {
  advanceFolderPickerNavigation,
  areFolderPickerPathsEqual,
  filterFolderPickerEntries,
  findActiveFolderPickerRootPath,
  getFolderPickerSuggestions,
  resolveFolderPickerInputPath,
  type FolderPickerNavigationState,
} from './remoteFolderPickerState'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function FolderPickerRootIcon({ kind }: { kind: FolderPickerRootKind }) {
  if (kind === 'drive') {
    return <HardDrive size={17} strokeWidth={1.9} />
  }
  if (kind === 'home') {
    return <Home size={17} strokeWidth={1.9} />
  }
  if (kind === 'downloads') {
    return <Download size={17} strokeWidth={1.9} />
  }
  if (kind === 'documents') {
    return <FileText size={17} strokeWidth={1.9} />
  }
  if (kind === 'pictures') {
    return <Image size={17} strokeWidth={1.9} />
  }
  if (kind === 'music') {
    return <Music size={17} strokeWidth={1.9} />
  }
  if (kind === 'videos') {
    return <Video size={17} strokeWidth={1.9} />
  }
  return <Folder size={17} strokeWidth={1.9} />
}

interface RemoteFolderPickerDialogProps {
  onCancel: () => void
  onSelect: (folderPath: string) => Promise<void>
}

interface FolderPickerContextMenuState {
  position: {
    x: number
    y: number
  }
  targetEntry: FolderPickerEntry | null
}

export function RemoteFolderPickerDialog({
  onCancel,
  onSelect,
}: RemoteFolderPickerDialogProps) {
  const [roots, setRoots] = useState<FolderPickerRoot[]>([])
  const [directory, setDirectory] = useState<FolderPickerDirectory | null>(null)
  const [navigation, setNavigation] = useState<FolderPickerNavigationState>({
    history: [],
    index: -1,
  })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [isCreatingFolderBusy, setIsCreatingFolderBusy] = useState(false)
  const [creationParentPath, setCreationParentPath] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [isRenamingBusy, setIsRenamingBusy] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<FolderPickerContextMenuState | null>(null)
  const [folderInputValue, setFolderInputValue] = useState('')
  const [isFolderInputFocused, setIsFolderInputFocused] = useState(false)
  const [folderSuggestionIndex, setFolderSuggestionIndex] = useState(0)
  const requestSequenceRef = useRef(0)
  const newFolderInputRef = useRef<HTMLInputElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

  const fetchDirectory = useCallback(async (folderPath: string) => {
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    setIsLoading(true)
    setError(null)

    try {
      const nextDirectory = await window.tidecodeHistory.listFolderPickerDirectory(folderPath)
      if (requestSequenceRef.current !== requestId) {
        return null
      }
      setDirectory(nextDirectory)
      setSelectedPath(null)
      setSearchQuery('')
      setFolderInputValue(nextDirectory.breadcrumbs.at(-1)?.label ?? nextDirectory.path)
      setFolderSuggestionIndex(0)
      return nextDirectory
    } catch (caughtError) {
      if (requestSequenceRef.current === requestId) {
        setError(getErrorMessage(caughtError))
      }
      return null
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function initialize() {
      setIsLoading(true)
      setError(null)
      try {
        const rootResult = await window.tidecodeHistory.getFolderPickerRoots()
        if (cancelled) {
          return
        }
        setRoots(rootResult.roots)
        const initialDirectory = await fetchDirectory(rootResult.initialPath)
        if (cancelled || !initialDirectory) {
          return
        }
        setNavigation({
          history: [initialDirectory.path],
          index: 0,
        })
      } catch (caughtError) {
        if (!cancelled) {
          setError(getErrorMessage(caughtError))
          setIsLoading(false)
        }
      }
    }

    void initialize()
    return () => {
      cancelled = true
      requestSequenceRef.current += 1
    }
  }, [fetchDirectory])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }
      if (contextMenuState) {
        setContextMenuState(null)
        return
      }
      if (isCreatingFolder) {
        setIsCreatingFolder(false)
        setCreationParentPath(null)
        setNewFolderName('')
        return
      }
      if (renamingPath) {
        setRenamingPath(null)
        setRenameName('')
        return
      }
      if (!isSubmitting) {
        onCancel()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [contextMenuState, isCreatingFolder, isSubmitting, onCancel, renamingPath])

  useEffect(() => {
    if (!contextMenuState) {
      return
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node) || contextMenuRef.current?.contains(target)) {
        return
      }
      setContextMenuState(null)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [contextMenuState])

  useEffect(() => {
    if (isCreatingFolder) {
      newFolderInputRef.current?.focus()
    }
  }, [isCreatingFolder])

  useEffect(() => {
    if (!renamingPath) {
      return
    }
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingPath])

  const visibleEntries = useMemo(
    () => filterFolderPickerEntries(directory?.entries ?? [], searchQuery),
    [directory?.entries, searchQuery],
  )
  const quickAccessRoots = roots.filter((root) => root.kind !== 'drive')
  const driveRoots = roots.filter((root) => root.kind === 'drive')
  const activeRootPath = findActiveFolderPickerRootPath(roots, directory?.path)
  const canGoBack = navigation.index > 0
  const canGoForward = navigation.index >= 0 && navigation.index < navigation.history.length - 1
  const currentDirectoryName = directory?.breadcrumbs.at(-1)?.label ?? ''
  const folderSuggestions = useMemo(
    () => getFolderPickerSuggestions(directory?.entries ?? [], folderInputValue),
    [directory?.entries, folderInputValue],
  )
  const selectedFolderPath = selectedPath ?? (
    directory
      ? resolveFolderPickerInputPath(
        directory.entries,
        currentDirectoryName,
        directory.path,
        folderInputValue,
      )
      : null
  )
  const contextMenuStyle = useMemo(() => {
    if (!contextMenuState || typeof window === 'undefined') {
      return undefined
    }

    const viewportPadding = 8
    const menuWidth = 220
    const menuHeight = contextMenuState.targetEntry ? 430 : 165
    return {
      left: Math.max(
        viewportPadding,
        Math.min(contextMenuState.position.x, window.innerWidth - menuWidth - viewportPadding),
      ),
      top: Math.max(
        viewportPadding,
        Math.min(contextMenuState.position.y, window.innerHeight - menuHeight - viewportPadding),
      ),
    }
  }, [contextMenuState])

  const navigateTo = useCallback(async (folderPath: string) => {
    if (directory && areFolderPickerPathsEqual(directory.path, folderPath)) {
      setContextMenuState(null)
      return
    }
    const nextDirectory = await fetchDirectory(folderPath)
    if (!nextDirectory) {
      return
    }
    setNavigation((current) => advanceFolderPickerNavigation(current, nextDirectory.path))
    setIsCreatingFolder(false)
    setCreationParentPath(null)
    setNewFolderName('')
    setRenamingPath(null)
    setRenameName('')
    setContextMenuState(null)
  }, [directory, fetchDirectory])

  const navigateToHistoryIndex = useCallback(async (targetIndex: number) => {
    const targetPath = navigation.history[targetIndex]
    if (!targetPath) {
      return
    }
    const nextDirectory = await fetchDirectory(targetPath)
    if (!nextDirectory) {
      return
    }
    setNavigation((current) => ({
      ...current,
      index: targetIndex,
    }))
    setIsCreatingFolder(false)
    setCreationParentPath(null)
    setNewFolderName('')
    setRenamingPath(null)
    setRenameName('')
    setContextMenuState(null)
  }, [fetchDirectory, navigation.history])

  async function handleCreateFolder(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const parentPath = creationParentPath ?? directory?.path ?? null
    if (!parentPath || isCreatingFolderBusy) {
      return
    }

    setIsCreatingFolderBusy(true)
    setError(null)
    try {
      const createdEntry = await window.tidecodeHistory.createFolderPickerDirectory(
        parentPath,
        newFolderName,
      )
      const refreshedDirectory = await fetchDirectory(parentPath)
      if (refreshedDirectory) {
        setSelectedPath(createdEntry.path)
        setFolderInputValue(createdEntry.name)
        setFolderSuggestionIndex(0)
        setIsCreatingFolder(false)
        setCreationParentPath(null)
        setNewFolderName('')
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    } finally {
      setIsCreatingFolderBusy(false)
    }
  }

  async function handleSelectFolder() {
    if (!selectedFolderPath || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await onSelect(selectedFolderPath)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
      setIsSubmitting(false)
    }
  }

  function selectFolderSuggestion(folderPath: string, folderName: string) {
    setSelectedPath(folderPath)
    setFolderInputValue(folderName)
    setFolderSuggestionIndex(0)
    setIsFolderInputFocused(false)
    folderInputRef.current?.blur()
  }

  function openContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    targetEntry: FolderPickerEntry | null,
  ) {
    event.preventDefault()
    event.stopPropagation()
    if (targetEntry) {
      setSelectedPath(targetEntry.path)
      setFolderInputValue(targetEntry.name)
      setFolderSuggestionIndex(0)
    }
    setContextMenuState({
      position: {
        x: event.clientX,
        y: event.clientY,
      },
      targetEntry,
    })
  }

  async function startCreateFolderFromContextMenu() {
    const parentPath = contextMenuState?.targetEntry?.path ?? directory?.path ?? null
    setContextMenuState(null)
    if (!parentPath) {
      return
    }

    if (directory?.path !== parentPath) {
      const nextDirectory = await fetchDirectory(parentPath)
      if (!nextDirectory) {
        return
      }
      setNavigation((current) => advanceFolderPickerNavigation(current, nextDirectory.path))
      setCreationParentPath(nextDirectory.path)
    } else {
      setCreationParentPath(directory.path)
    }

    setSearchQuery('')
    setError(null)
    setRenamingPath(null)
    setRenameName('')
    setNewFolderName('')
    setIsCreatingFolder(true)
  }

  async function refreshCurrentDirectory() {
    setContextMenuState(null)
    if (!directory) {
      return
    }
    await fetchDirectory(directory.path)
  }

  function startRenameFromContextMenu() {
    const targetEntry = contextMenuState?.targetEntry
    setContextMenuState(null)
    if (!targetEntry) {
      return
    }

    setIsCreatingFolder(false)
    setCreationParentPath(null)
    setNewFolderName('')
    setError(null)
    setRenamingPath(targetEntry.path)
    setRenameName(targetEntry.name)
  }

  async function submitRename() {
    const targetPath = renamingPath
    const nextName = renameName.trim()
    if (!targetPath || !directory || isRenamingBusy) {
      return
    }
    if (!nextName) {
      setError('Folder name is required.')
      return
    }

    setIsRenamingBusy(true)
    setError(null)
    try {
      const renamedEntry = await window.tidecodeHistory.renameFolderPickerDirectory(
        targetPath,
        nextName,
      )
      const refreshedDirectory = await fetchDirectory(directory.path)
      if (refreshedDirectory) {
        setSelectedPath(renamedEntry.path)
        setFolderInputValue(renamedEntry.name)
      }
      setRenamingPath(null)
      setRenameName('')
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
      window.requestAnimationFrame(() => renameInputRef.current?.focus())
    } finally {
      setIsRenamingBusy(false)
    }
  }

  async function deleteContextTarget() {
    const targetEntry = contextMenuState?.targetEntry
    setContextMenuState(null)
    if (!targetEntry || !directory) {
      return
    }

    setError(null)
    try {
      await window.tidecodeHistory.deleteFolderPickerDirectory(targetEntry.path)
      if (selectedPath === targetEntry.path) {
        setSelectedPath(null)
        setFolderInputValue(currentDirectoryName)
      }
      await fetchDirectory(directory.path)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function copyOrCutContextTarget(mode: 'copy' | 'cut') {
    const targetEntry = contextMenuState?.targetEntry
    setContextMenuState(null)
    if (!targetEntry) {
      return
    }

    setError(null)
    try {
      await window.tidecodeHistory.writeFolderPickerClipboard(targetEntry.path, mode)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function pasteIntoContextTarget() {
    const targetPath = contextMenuState?.targetEntry?.path ?? directory?.path ?? null
    setContextMenuState(null)
    if (!targetPath || !directory) {
      return
    }

    setError(null)
    try {
      const pastedEntries = await window.tidecodeHistory.pasteFolderPickerClipboard(targetPath)
      const refreshedDirectory = await fetchDirectory(directory.path)
      if (
        refreshedDirectory
        && areFolderPickerPathsEqual(targetPath, directory.path)
        && pastedEntries[0]
      ) {
        setSelectedPath(pastedEntries[0].path)
        setFolderInputValue(pastedEntries[0].name)
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  async function copyContextPath(pathKind: 'absolute' | 'relative') {
    const targetEntry = contextMenuState?.targetEntry
    setContextMenuState(null)
    if (!targetEntry) {
      return
    }

    const clipboardText = pathKind === 'absolute' ? targetEntry.path : targetEntry.name
    try {
      await navigator.clipboard.writeText(clipboardText)
      setError(null)
    } catch (caughtError) {
      setError(getErrorMessage(caughtError))
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[2200] flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onCancel()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-folder-picker-title"
        className="flex h-full w-full min-w-0 flex-col overflow-hidden border-border bg-surface shadow-soft sm:h-[min(760px,calc(100dvh-3rem))] sm:max-w-6xl sm:rounded-2xl sm:border"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 id="remote-folder-picker-title" className="text-sm font-semibold text-foreground">
            Select folder
          </h2>
          <button
            type="button"
            aria-label="Close folder picker"
            onClick={onCancel}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2.5 sm:flex-row sm:items-center">
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Back"
              disabled={!canGoBack || isLoading}
              onClick={() => {
                void navigateToHistoryIndex(navigation.index - 1)
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
            >
              <ArrowLeft size={17} />
            </button>
            <button
              type="button"
              aria-label="Forward"
              disabled={!canGoForward || isLoading}
              onClick={() => {
                void navigateToHistoryIndex(navigation.index + 1)
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
            >
              <ArrowRight size={17} />
            </button>
            <button
              type="button"
              aria-label="Up one folder"
              disabled={!directory?.parentPath || isLoading}
              onClick={() => {
                if (directory?.parentPath) {
                  void navigateTo(directory.parentPath)
                }
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-35"
            >
              <ArrowUp size={17} />
            </button>
          </div>

          <div className="flex min-h-9 min-w-0 flex-1 items-center overflow-x-auto rounded-lg border border-border bg-background px-2">
            {directory?.breadcrumbs.map((breadcrumb, index) => (
              <div key={breadcrumb.path} className="flex shrink-0 items-center">
                {index > 0 ? (
                  <ChevronRight size={14} className="mx-0.5 text-muted-foreground" />
                ) : null}
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    void navigateTo(breadcrumb.path)
                  }}
                  className="max-w-48 truncate rounded-md px-1.5 py-1 text-left text-sm text-foreground transition-colors hover:bg-surface-muted disabled:opacity-50"
                >
                  {breadcrumb.label}
                </button>
              </div>
            ))}
            {!directory ? <span className="text-sm text-muted-foreground">Loading...</span> : null}
          </div>

          <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 sm:w-56">
            <Search size={15} className="shrink-0 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search folders"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="w-40 shrink-0 overflow-y-auto border-r border-border bg-surface-muted/35 p-2 sm:w-52">
            {quickAccessRoots.length > 0 ? (
              <>
                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quick access
                </div>
                <div className="space-y-0.5">
                  {quickAccessRoots.map((root) => {
                    const isActive = root.path === activeRootPath
                    return (
                      <button
                        key={root.path}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        disabled={isLoading}
                        onClick={() => {
                          void navigateTo(root.path)
                        }}
                        className={[
                          'flex h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left text-sm font-medium transition-colors disabled:opacity-50',
                          isActive
                            ? 'bg-brand-soft text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground',
                        ].join(' ')}
                      >
                        <span className={isActive ? 'shrink-0 text-foreground' : 'shrink-0 text-muted-foreground'}>
                          <FolderPickerRootIcon kind={root.kind} />
                        </span>
                        <span className="truncate">{root.label}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {driveRoots.length > 0 ? (
              <>
                <div className="mt-4 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  This PC
                </div>
                <div className="space-y-0.5">
                  {driveRoots.map((root) => {
                    const isActive = root.path === activeRootPath
                    return (
                      <button
                        key={root.path}
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        disabled={isLoading}
                        onClick={() => {
                          void navigateTo(root.path)
                        }}
                        className={[
                          'flex h-9 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left text-sm font-medium transition-colors disabled:opacity-50',
                          isActive
                            ? 'bg-brand-soft text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground',
                        ].join(' ')}
                      >
                        <HardDrive
                          size={17}
                          className={isActive ? 'shrink-0 text-foreground' : 'shrink-0 text-muted-foreground'}
                        />
                        <span className="truncate">{root.label}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {error ? (
              <div className="mx-3 mt-3 rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger-foreground">
                {error}
              </div>
            ) : null}

            <div
              className="min-h-0 flex-1 overflow-y-auto p-2"
              onContextMenu={(event) => openContextMenu(event, null)}
            >
              {isLoading ? (
                <div className="flex h-full min-h-40 items-center justify-center text-muted-foreground">
                  <LoaderCircle size={20} className="animate-spin" />
                </div>
              ) : (
                <div className="space-y-0.5">
                  {isCreatingFolder ? (
                    <form
                      onSubmit={(event) => void handleCreateFolder(event)}
                      className="flex h-9 w-full min-w-0 items-center gap-2 bg-surface-muted px-3 text-left text-sm text-foreground"
                    >
                      <Folder size={16} className="shrink-0 text-subtle-foreground" />
                      <input
                        ref={newFolderInputRef}
                        value={newFolderName}
                        onChange={(event) => setNewFolderName(event.target.value)}
                        onBlur={() => {
                          if (isCreatingFolderBusy) {
                            return
                          }
                          if (newFolderName.trim().length === 0) {
                            setIsCreatingFolder(false)
                            setCreationParentPath(null)
                            setNewFolderName('')
                            return
                          }
                          void handleCreateFolder()
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            event.stopPropagation()
                            setIsCreatingFolder(false)
                            setCreationParentPath(null)
                            setNewFolderName('')
                          }
                        }}
                        placeholder="folder-name"
                        disabled={isCreatingFolderBusy}
                        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:opacity-60"
                      />
                    </form>
                  ) : null}
                  {visibleEntries.map((entry) => {
                    const isSelected = selectedPath === entry.path
                    if (renamingPath === entry.path) {
                      return (
                        <form
                          key={entry.path}
                          onSubmit={(event) => {
                            event.preventDefault()
                            void submitRename()
                          }}
                          className="flex h-9 w-full min-w-0 items-center gap-2 bg-surface-muted px-3 text-left text-sm text-foreground"
                        >
                          <Folder size={16} className="shrink-0 text-subtle-foreground" />
                          <input
                            ref={renameInputRef}
                            value={renameName}
                            onChange={(event) => setRenameName(event.target.value)}
                            onBlur={() => {
                              if (isRenamingBusy) {
                                return
                              }
                              if (renameName.trim().length === 0) {
                                setRenamingPath(null)
                                setRenameName('')
                                return
                              }
                              void submitRename()
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                event.stopPropagation()
                                setRenamingPath(null)
                                setRenameName('')
                              }
                            }}
                            placeholder="folder-name"
                            disabled={isRenamingBusy}
                            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:opacity-60"
                          />
                        </form>
                      )
                    }
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        onContextMenu={(event) => openContextMenu(event, entry)}
                        onClick={() => {
                          selectFolderSuggestion(entry.path, entry.name)
                        }}
                        onDoubleClick={() => {
                          void navigateTo(entry.path)
                        }}
                        className={
                          isSelected
                            ? 'grid h-9 w-full grid-cols-[minmax(0,1fr)_7rem] items-center rounded-lg bg-brand-soft px-3 text-left text-sm text-foreground'
                            : 'grid h-9 w-full grid-cols-[minmax(0,1fr)_7rem] items-center rounded-lg px-3 text-left text-sm text-foreground transition-colors hover:bg-surface-muted'
                        }
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Folder size={16} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">{entry.name}</span>
                        </span>
                        <span className="hidden text-xs text-muted-foreground sm:block">File folder</span>
                      </button>
                    )
                  })}
                  {!isCreatingFolder && visibleEntries.length === 0 ? (
                    <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                      {searchQuery.trim() ? 'No folders match this search.' : 'This folder contains no subfolders.'}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {contextMenuState ? (
          <div
            ref={contextMenuRef}
            role="menu"
            aria-label="Folder picker actions"
            data-floating-menu-root="true"
            className="non-selectable-ui fixed z-[2300] min-w-[210px] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
            style={contextMenuStyle}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void startCreateFolderFromContextMenu()
              }}
              className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
            >
              New Folder
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void refreshCurrentDirectory()
              }}
              className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
            >
              Refresh
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void pasteIntoContextTarget()
              }}
              className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
            >
              Paste
            </button>
            {contextMenuState.targetEntry ? (
              <>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void deleteContextTarget()
                  }}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-danger-foreground transition-colors hover:bg-danger-surface"
                >
                  Delete Folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={startRenameFromContextMenu}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void copyOrCutContextTarget('cut')
                  }}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                >
                  Cut
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void copyOrCutContextTarget('copy')
                  }}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                >
                  Copy
                </button>
                <div className="my-1 h-px bg-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void copyContextPath('absolute')
                  }}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                >
                  Copy Path
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void copyContextPath('relative')
                  }}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                >
                  Copy Relative Path
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="shrink-0 border-t border-border bg-surface px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground">Folder:</span>
              <div className="relative min-w-0 flex-1">
                {isFolderInputFocused && folderInputValue.trim() && folderSuggestions.length > 0 ? (
                  <div
                    role="listbox"
                    aria-label="Folder suggestions"
                    className="absolute bottom-[calc(100%+0.4rem)] left-0 right-0 z-30 max-h-52 overflow-y-auto rounded-xl border border-border bg-surface shadow-soft"
                  >
                    {folderSuggestions.map((entry, index) => {
                      const isHighlighted = index === folderSuggestionIndex
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          role="option"
                          aria-selected={isHighlighted}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setFolderSuggestionIndex(index)}
                          onClick={() => selectFolderSuggestion(entry.path, entry.name)}
                          className={
                            isHighlighted
                              ? 'flex w-full items-center gap-2 bg-[var(--dropdown-option-active-surface)] px-3 py-2 text-left text-sm text-foreground'
                              : 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-active-surface)]'
                          }
                        >
                          <Folder size={15} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">{entry.name}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                <input
                  ref={folderInputRef}
                  value={folderInputValue}
                  onFocus={() => {
                    setIsFolderInputFocused(true)
                    setFolderSuggestionIndex(0)
                  }}
                  onBlur={() => setIsFolderInputFocused(false)}
                  onChange={(event) => {
                    setFolderInputValue(event.target.value)
                    setSelectedPath(null)
                    setFolderSuggestionIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
                      && folderSuggestions.length > 0
                    ) {
                      event.preventDefault()
                      const direction = event.key === 'ArrowDown' ? 1 : -1
                      setFolderSuggestionIndex((currentIndex) =>
                        (currentIndex + direction + folderSuggestions.length) % folderSuggestions.length
                      )
                      return
                    }

                    if ((event.key === 'Enter' || event.key === 'Tab') && folderSuggestions.length > 0) {
                      const suggestedFolder = folderSuggestions[folderSuggestionIndex]
                      if (suggestedFolder) {
                        event.preventDefault()
                        selectFolderSuggestion(suggestedFolder.path, suggestedFolder.name)
                        return
                      }
                    }

                    if (event.key === 'Enter' && selectedFolderPath) {
                      event.preventDefault()
                      void handleSelectFolder()
                    }
                  }}
                  placeholder="Type a folder name"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 w-full min-w-0 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:outline-none"
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={isSubmitting}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSelectFolder()
                }}
                disabled={!selectedFolderPath || isLoading || isSubmitting}
                className="provider-primary-action-button inline-flex h-10 min-w-28 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? 'Adding...' : 'Select Folder'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
