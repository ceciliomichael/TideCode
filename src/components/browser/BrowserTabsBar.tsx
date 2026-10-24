import { BrowserNewTabMenu } from './BrowserNewTabMenu'
import { Bot, Globe2, Maximize, Minimize, VenetianMask, X } from 'lucide-react'
import { useState } from 'react'
import { handleWorkspaceTabStripWheel, WORKSPACE_TAB_ACTIONS_CLASS_NAME } from '../ui/workspaceTabStrip'
import { Tooltip } from '../Tooltip'
import { BrowserMenu } from './BrowserMenu'
import type {
  BrowserPageControls,
  BrowserPageState,
} from './useBrowserPageActions'
import type { BrowserTab } from './browserTabUtils'

function BrowserTabFavicon({ faviconUrl }: { faviconUrl: string }) {
  const [failedUrl, setFailedUrl] = useState('')
  const showFavicon = Boolean(faviconUrl) && failedUrl !== faviconUrl

  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {showFavicon ? (
        <img
          src={faviconUrl}
          alt=""
          draggable={false}
          className="max-h-full max-w-full object-contain"
          onError={() => setFailedUrl(faviconUrl)}
        />
      ) : (
        <Globe2 size={14} />
      )}
    </span>
  )
}

interface BrowserTabsBarProps {
  isInMainPanel?: boolean
  onTogglePlacement?: () => void
  activeTabId: string
  onCloseTab: (tabId: string) => void
  onCreateTab: (incognito: boolean) => Promise<void>
  isFullScreen: boolean
  onToggleFullScreen: () => void
  onSelectTab: (tabId: string) => void
  pageState: BrowserPageState
  onOpenDevTools: BrowserPageControls['openDevTools']
  onChangeZoom: BrowserPageControls['changeZoom']
  tabs: readonly BrowserTab[]
}

export function BrowserTabsBar({
  isInMainPanel,
  onTogglePlacement,
  activeTabId,
  onCloseTab,
  onCreateTab,
  isFullScreen,
  onToggleFullScreen,
  onSelectTab,
  tabs,
  pageState,
  onOpenDevTools,
  onChangeZoom,
}: BrowserTabsBarProps) {
  return (
    <div className="non-selectable-ui flex h-10 shrink-0 border-b border-border bg-background">
      <div
        onWheel={handleWorkspaceTabStripWheel}
        className="workspace-tabs-scroll-viewport flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className="group relative inline-flex h-full w-[200px] shrink-0 items-stretch border-r border-border"
            >
              <button
                type="button"
                onClick={() => onSelectTab(tab.id)}
                onMouseDown={(event) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  onCloseTab(tab.id)
                }}
                className={[
                  'inline-flex h-full w-full min-w-0 items-center gap-2 px-3 pr-9 text-sm transition-colors',
                  isActive
                    ? 'border-t-2 border-t-brand bg-background text-foreground'
                    : 'border-t-2 border-t-transparent bg-background text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                ].join(' ')}
              >
                <span
                  className="flex shrink-0 items-center"
                  aria-label={tab.incognito ? 'Incognito tab' : tab.aiOwned ? 'AI browser tab' : undefined}
                >
                  {tab.incognito ? (
                    <VenetianMask size={14} />
                  ) : tab.aiOwned ? (
                    <Bot size={14} />
                  ) : (
                    <BrowserTabFavicon faviconUrl={tab.faviconUrl} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">
                  {tab.title}
                </span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onCloseTab(tab.id)
                }}
                className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Close ${tab.title}`}
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <div
        data-browser-tab-actions
        className={WORKSPACE_TAB_ACTIONS_CLASS_NAME}
      >
        <BrowserNewTabMenu onCreateTab={onCreateTab} />
        <Tooltip
          content={
            isFullScreen ? 'Exit fullscreen browser' : 'Fullscreen browser'
          }
          side="bottom"
          noWrap
        >
          <button
            type="button"
            aria-label={
              isFullScreen ? 'Exit fullscreen browser' : 'Fullscreen browser'
            }
            onClick={onToggleFullScreen}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
          >
            {isFullScreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </Tooltip>
        <BrowserMenu
          key={activeTabId}
          isInMainPanel={isInMainPanel}
          onTogglePlacement={onTogglePlacement}
          partition={tabs.find((tab) => tab.id === activeTabId)!.partition}
          pageState={pageState}
          onOpenDevTools={onOpenDevTools}
          onChangeZoom={onChangeZoom}
        />
      </div>
    </div>
  )
}
