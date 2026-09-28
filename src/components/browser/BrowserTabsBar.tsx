import { Globe2, Plus, X } from 'lucide-react'
import type { WheelEvent as ReactWheelEvent } from 'react'
import type { BrowserTab } from './browserTabUtils'

interface BrowserTabsBarProps {
  activeTabId: string
  onCloseTab: (tabId: string) => void
  onCreateTab: () => void
  onSelectTab: (tabId: string) => void
  tabs: readonly BrowserTab[]
}

export function BrowserTabsBar({
  activeTabId,
  onCloseTab,
  onCreateTab,
  onSelectTab,
  tabs,
}: BrowserTabsBarProps) {
  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const target = event.currentTarget
    if (target.scrollWidth <= target.clientWidth) return

    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (delta === 0) return

    event.preventDefault()
    target.scrollLeft += delta
  }

  return (
    <div className="non-selectable-ui flex h-10 shrink-0 border-b border-border bg-background">
      <div
        onWheel={handleWheel}
        className="workspace-tabs-scroll-viewport flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div key={tab.id} className="group relative inline-flex h-full w-[200px] shrink-0 items-stretch border-r border-border">
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
                <Globe2 size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{tab.title}</span>
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

      <button
        type="button"
        onClick={onCreateTab}
        className="flex h-full w-10 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        aria-label="New browser tab"
        title="New tab"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
