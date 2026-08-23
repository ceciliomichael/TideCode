import { ArrowLeft, Settings2 } from 'lucide-react'
import { getVisibleSettingsItems, type SettingsItemId } from './settingsItems'
import { getRendererAppSettingsSurface } from '../../lib/appSettingsScopes'

interface SettingsSidebarPanelProps {
  activeItemId: SettingsItemId
  onBackToApp: () => void
  onSelectItem: (itemId: SettingsItemId) => void
}

export function SettingsSidebarPanel({
  activeItemId,
  onBackToApp,
  onSelectItem,
}: SettingsSidebarPanelProps) {
  const surface = getRendererAppSettingsSurface()
  const visibleItems = getVisibleSettingsItems(surface, Boolean(window.tidecodeRemoteHost))

  return (
    <aside className="scroll-stable flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--sidebar-panel-surface)] px-4 pb-5 pt-3 md:px-5">
      <div className="pb-4">
<div className="hidden h-10 md:block" aria-hidden="true" />

        <button
          type="button"
          onClick={onBackToApp}
          className="mt-4 flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-sm font-medium text-foreground transition-colors duration-200 ease-out hover:bg-[var(--sidebar-hover-surface)]"
        >
          <ArrowLeft size={18} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
          <span>Back to app</span>
        </button>

        <div className="mt-5">
          <div className="flex items-center gap-2 px-1">
            <Settings2 size={16} strokeWidth={2.2} className="text-brand" />
            <p className="text-sm font-semibold text-foreground">Settings</p>
          </div>

          <nav className="mt-3 space-y-2" aria-label="Settings navigation">
{visibleItems.map((item) => {
              const isActive = item.id === activeItemId

              return (
                <div
                  key={item.id}
                  className={[
                    'group flex items-center gap-2 rounded-xl px-2 py-1 transition-colors',
                    isActive ? 'bg-brand-soft shadow-sm' : 'hover:bg-[var(--sidebar-hover-surface)]',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => onSelectItem(item.id)}
                    className={[
                      'min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors',
                      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span
                      className={[
                        'block truncate text-sm font-medium',
                        isActive ? 'text-foreground' : 'text-inherit',
                      ].join(' ')}
                    >
                      {item.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                  </button>
                </div>
              )
            })}
          </nav>
        </div>
      </div>
    </aside>
  )
}
