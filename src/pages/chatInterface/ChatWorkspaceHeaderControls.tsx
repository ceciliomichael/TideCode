import type { ReactNode } from 'react'
import { FolderTree, GitBranch, GitCommitHorizontal, GitCompareArrows, Globe2, Terminal } from 'lucide-react'
import { Tooltip } from '../../components/Tooltip'

interface HeaderControlProps {
  active?: boolean
  ariaPressed?: boolean
  children: ReactNode
  disabled: boolean
  disabledColorMode?: 'active' | 'inherit' | 'muted'
  label: string
  onClick: () => void
  text?: string
}

function HeaderControl({
  active = false,
  ariaPressed,
  children,
  disabled,
  disabledColorMode = 'inherit',
  label,
  onClick,
  text,
}: HeaderControlProps) {
  const disabledColorClass =
    disabledColorMode === 'active'
      ? active
        ? 'text-foreground'
        : 'text-muted-foreground'
      : disabledColorMode === 'muted'
        ? 'text-muted-foreground'
        : ''
  const button = (
    <button
      type="button"
      aria-pressed={ariaPressed}
      disabled={disabled}
      onClick={onClick}
      className={[
        'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
        disabled
          ? `cursor-not-allowed opacity-50 ${disabledColorClass}`
          : active
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {children}
      {text ? <span className="hidden md:inline">{text}</span> : null}
    </button>
  )

  return disabled ? button : <Tooltip content={label} side="bottom">{button}</Tooltip>
}

function HeaderDivider() {
  return <div className="mx-1 h-5 w-px bg-border" />
}

interface ChatWorkspaceHeaderControlsProps {
  addedLineCount: number | null
  hasRepository: boolean
  isDiffPanelOpen: boolean
  isExplorerOpen: boolean
  isBrowserOpen: boolean
  isSourceControlPanelOpen: boolean
  isTerminalOpen: boolean
  isWorkspaceRepoHeaderControlDisabled: boolean
  isSourceControlButtonDisabled: boolean
  onOpenCommitModal: () => void
  onOpenDiffPanel: () => void
  onOpenSourceControlPanel: () => void
  onToggleExplorerPanel: () => void
  onToggleWorkspaceBrowser: () => void
  onToggleTerminalPanel: () => void
  removedLineCount: number | null
}

export function ChatWorkspaceHeaderControls({
  addedLineCount,
  hasRepository,
  isDiffPanelOpen,
  isExplorerOpen,
  isBrowserOpen,
  isSourceControlPanelOpen,
  isTerminalOpen,
  isWorkspaceRepoHeaderControlDisabled,
  isSourceControlButtonDisabled,
  onOpenCommitModal,
  onOpenDiffPanel,
  onOpenSourceControlPanel,
  onToggleExplorerPanel,
  onToggleWorkspaceBrowser,
  onToggleTerminalPanel,
  removedLineCount,
}: ChatWorkspaceHeaderControlsProps) {
  const supportsBrowser = typeof window !== 'undefined' && (
    navigator.userAgent.toLowerCase().includes('electron')
  )

  return (
    <div className="hidden items-center gap-1 md:flex">
      {supportsBrowser ? (
        <>
          <HeaderControl
            active={isBrowserOpen}
            ariaPressed={isBrowserOpen}
            disabled={false}
            label={isBrowserOpen ? 'Hide browser panel' : 'Open browser panel'}
            onClick={onToggleWorkspaceBrowser}
            text="Browser"
          >
            <Globe2 size={16} className="shrink-0" />
          </HeaderControl>
          <HeaderDivider />
        </>
      ) : null}
      <HeaderControl
        active={isTerminalOpen}
        disabled={false}
        label={isTerminalOpen ? 'Hide terminal panel' : 'Open terminal panel'}
        onClick={onToggleTerminalPanel}
        text="Terminal"
      >
        <Terminal size={16} className="shrink-0" />
      </HeaderControl>
      <HeaderDivider />
      <HeaderControl
        disabled={isWorkspaceRepoHeaderControlDisabled}
        disabledColorMode="muted"
        label={hasRepository ? 'Commit changes' : 'Open a git-backed folder to commit'}
        onClick={onOpenCommitModal}
        text="Commit"
      >
        <GitCommitHorizontal size={16} className="shrink-0" />
      </HeaderControl>
      <HeaderDivider />
      <HeaderControl
        active={isSourceControlPanelOpen}
        disabled={isSourceControlButtonDisabled}
        disabledColorMode="active"
        label={hasRepository ? 'Toggle Source Control panel' : 'Initialize or publish this folder'}
        onClick={onOpenSourceControlPanel}
        text="Source Control"
      >
        <GitBranch size={16} className="shrink-0" />
      </HeaderControl>
      <HeaderDivider />
      <HeaderControl
        active={isDiffPanelOpen}
        disabled={isWorkspaceRepoHeaderControlDisabled}
        disabledColorMode="active"
        label={hasRepository ? 'Toggle Diff panel' : 'Open a git-backed folder'}
        onClick={onOpenDiffPanel}
      >
        <GitCompareArrows size={16} className="shrink-0" />
        {hasRepository && addedLineCount !== null && removedLineCount !== null ? (
          <>
          <span className="text-git-added">{`+${addedLineCount}`}</span>
          <span className="text-git-removed">{`-${removedLineCount}`}</span>
          </>
        ) : null}
      </HeaderControl>
      <HeaderDivider />
      <HeaderControl
        active={isExplorerOpen}
        disabled={false}
        label={isExplorerOpen ? 'Close explorer panel' : 'Open explorer panel'}
        onClick={onToggleExplorerPanel}
        text="Explorer"
      >
        <FolderTree size={16} className="shrink-0" />
      </HeaderControl>
    </div>
  )
}
