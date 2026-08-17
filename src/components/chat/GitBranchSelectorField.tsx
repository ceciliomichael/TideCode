import { Check, GitBranch, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'

interface GitBranchSelectorFieldProps {
  branches: readonly string[]
  currentBranch: string | null
  remoteBranches?: readonly string[]
  disabled?: boolean
  errorMessage?: string | null
  hasRepository: boolean
  isDetachedHead?: boolean
  isLoading?: boolean
  isSwitching?: boolean
  onChange: (branchName: string) => void | Promise<void>
  onCreateBranch: (branchName: string) => void | Promise<void>
  onRefresh?: () => void | Promise<void>
  triggerClassName?: string
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

export function GitBranchSelectorField({
  branches,
  currentBranch,
  remoteBranches = [],
  disabled = false,
  errorMessage = null,
  hasRepository,
  isDetachedHead = false,
  isLoading = false,
  isSwitching = false,
  onChange,
  onCreateBranch,
  onRefresh,
  triggerClassName,
}: GitBranchSelectorFieldProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const createBranchInputRef = useRef<HTMLInputElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const [highlightedBranch, setHighlightedBranch] = useState(currentBranch)
  const normalizedSearch = normalizeSearch(searchValue)
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    menuRef,
  })
  const isControlDisabled = disabled || isSwitching || !hasRepository
  const isCreateDisabled = isSwitching || newBranchName.trim().length === 0
  const localBranchSet = useMemo(() => new Set(branches), [branches])
  const remoteBranchSet = useMemo(() => new Set(remoteBranches), [remoteBranches])
  const selectableBranches = useMemo(
    () => [...branches, ...remoteBranches.filter((branchName) => !localBranchSet.has(branchName))],
    [branches, localBranchSet, remoteBranches],
  )
  const visibleBranches = useMemo(() => {
    if (normalizedSearch.length === 0) {
      return selectableBranches
    }

    return selectableBranches.filter((branchName) => branchName.toLowerCase().includes(normalizedSearch))
  }, [normalizedSearch, selectableBranches])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    searchInputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isCreateModalOpen) {
      return
    }

    createBranchInputRef.current?.focus()

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsCreateModalOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isCreateModalOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setHighlightedBranch(currentBranch)
  }, [currentBranch, isOpen])

  useEffect(() => {
    if (!hasRepository) {
      setIsOpen(false)
      setIsCreateModalOpen(false)
    }
  }, [hasRepository])

  function handleSelect(branchName: string) {
    setIsOpen(false)
    if (branchName === currentBranch) {
      return
    }

    void onChange(branchName)
  }

  function openCreateBranchModal() {
    setIsOpen(false)
    setNewBranchName(searchValue.trim())
    setIsCreateModalOpen(true)
  }

  function closeCreateBranchModal() {
    if (isSwitching) {
      return
    }

    setIsCreateModalOpen(false)
  }

  async function handleCreateBranchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextBranchName = newBranchName.trim()
    if (nextBranchName.length === 0) {
      return
    }

    try {
      await onCreateBranch(nextBranchName)
      setIsCreateModalOpen(false)
      setNewBranchName('')
    } catch {
      createBranchInputRef.current?.focus()
    }
  }

  const controlLabel = currentBranch ?? 'No repo'

  return (
    <div
      ref={containerRef}
      data-open={isOpen || isCreateModalOpen ? 'true' : 'false'}
      className="relative min-w-0 w-full max-w-full"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        data-open={isOpen ? 'true' : 'false'}
        disabled={isControlDisabled}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        className={['chat-runtime-control-trigger min-w-0 w-full max-w-full disabled:cursor-not-allowed', triggerClassName]
          .filter(Boolean)
          .join(' ')}
      >
        <GitBranch size={14} className="mr-1.5 shrink-0 text-current" />
        <span className="chat-runtime-control-label min-w-0 max-w-[14rem] truncate text-left">
          {controlLabel}
        </span>
        {isSwitching && hasRepository ? <RefreshCw size={13} className="ml-1.5 shrink-0 animate-spin text-current" /> : null}
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              data-floating-menu-root="true"
              className="fixed z-40 w-[min(20rem,calc(100vw-1rem))] min-w-[12rem] overflow-hidden rounded-xl border border-border bg-surface shadow-soft"
              style={menuStyle}
            >
              <div className="flex items-center gap-1.5 border-b border-border px-2 py-2">
                <div className="relative min-w-0 flex-1 pr-1">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search branches..."
                    className="h-9 w-full rounded-lg border border-border bg-surface-muted pl-8 pr-2.5 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Refresh branch list"
                  disabled={isLoading}
                  onClick={() => void onRefresh?.()}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-muted text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw size={14} className={isLoading ? 'animate-spin' : undefined} />
                </button>
              </div>

              <div
                role="listbox"
                aria-label="Git branches"
                onMouseLeave={() => setHighlightedBranch(currentBranch)}
                className="h-64 space-y-0.5 overflow-y-auto p-1"
              >
                {visibleBranches.length > 0 ? (
                  visibleBranches.map((branchName) => {
                    const isSelected = branchName === currentBranch
                    const isHighlighted = branchName === highlightedBranch
                    const isRemoteOnly = remoteBranchSet.has(branchName) && !localBranchSet.has(branchName)

                    return (
                      <button
                        key={branchName}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onMouseEnter={() => setHighlightedBranch(branchName)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelect(branchName)}
                        className={[
                          'flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-[background-color,color,box-shadow]',
                          isHighlighted
                            ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                            : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                        ].join(' ')}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] leading-5">{branchName}</span>
                          <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {isSelected
                              ? isDetachedHead
                                ? 'Detached HEAD'
                                : 'Current branch'
                              : isRemoteOnly
                                ? 'Remote branch'
                                : 'Local branch'}
                          </span>
                        </span>
                        {isSelected ? <Check size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-brand" /> : null}
                      </button>
                    )
                  })
                ) : (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">No branches found.</p>
                )}
              </div>

              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openCreateBranchModal}
                className="flex h-11 w-full items-center gap-2 border-t border-border px-3 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-active-surface)]"
              >
                <Plus size={16} className="shrink-0 text-muted-foreground" />
                <span className="truncate">Create and checkout new branch...</span>
              </button>

              {errorMessage ? (
                <div className="border-t border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">
                  {errorMessage}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {isCreateModalOpen
        ? createPortal(
            <div
              className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-center bg-black/12 px-4"
              style={{ top: 'env(titlebar-area-height, 0px)' }}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeCreateBranchModal()
                }
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-branch-title"
                className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-soft"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 id="create-branch-title" className="text-lg font-medium text-foreground">
                      Create new branch
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create a local branch and switch this workspace to it immediately.
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close create branch dialog"
                    onClick={closeCreateBranchModal}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X size={16} />
                  </button>
                </div>

                <form className="mt-5 space-y-4" onSubmit={handleCreateBranchSubmit}>
                  <div className="space-y-2">
                    <label htmlFor="create-branch-name" className="block text-sm font-medium text-foreground">
                      Branch name
                    </label>
                    <input
                      id="create-branch-name"
                      ref={createBranchInputRef}
                      type="text"
                      value={newBranchName}
                      onChange={(event) => setNewBranchName(event.target.value)}
                      placeholder="feature/my-new-branch"
                      className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                    />
                  </div>

                  {errorMessage ? (
                    <div className="rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">
                      {errorMessage}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeCreateBranchModal}
                      className="flex h-11 items-center rounded-xl bg-surface-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-[var(--dropdown-option-active-surface)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isCreateDisabled}
                      className={[
                        'flex h-11 items-center rounded-xl px-4 text-sm font-medium transition-colors',
                        isCreateDisabled
                          ? 'chat-send-button-disabled cursor-not-allowed'
                          : 'chat-send-button-enabled',
                      ].join(' ')}
                    >
                      {isSwitching ? 'Creating...' : 'Create and checkout'}
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
