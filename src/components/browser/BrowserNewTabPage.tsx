import { useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { BrandWord } from '../branding/BrandWord'
import type { BrowserVisitedSite } from './browserHistory'

interface BrowserNewTabPageProps {
  onNavigate: (value: string) => void
  visitedSites: readonly BrowserVisitedSite[]
}

function VisitedSiteIcon({ site }: { site: BrowserVisitedSite }) {
  const [failedIcon, setFailedIcon] = useState('')
  const showIcon = Boolean(site.faviconDataUrl) && failedIcon !== site.faviconDataUrl

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-sm font-medium text-muted-foreground" aria-hidden="true">
      {showIcon ? (
        <img
          src={site.faviconDataUrl}
          alt=""
          draggable={false}
          className="h-5 w-5 object-contain"
          onError={() => setFailedIcon(site.faviconDataUrl ?? '')}
        />
      ) : site.label.charAt(0).toUpperCase()}
    </span>
  )
}

export function BrowserNewTabPage({ onNavigate, visitedSites }: BrowserNewTabPageProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (query.trim()) {
      onNavigate(query)
    }
  }

  return (
    <section
      aria-label="New tab"
      className="grid h-full w-full grid-rows-[1fr_auto_2fr] justify-items-center overflow-auto bg-background px-6 py-10 text-foreground"
    >
      <div className="row-start-2 w-full max-w-xl text-center">
        <h1 className="flex justify-center">
          <BrandWord className="h-24 w-[264px] max-w-full text-brand" />
        </h1>
        <form
          onSubmit={handleSubmit}
          className="relative mt-2 rounded-2xl border border-border bg-surface-muted"
        >
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search"
            placeholder="Search"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-11 w-full min-w-0 rounded-2xl border-0 bg-transparent pl-12 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
          />
        </form>
        {visitedSites.length > 0 ? (
          <div className="mt-8 text-left">
            <h2 className="text-xs font-medium text-muted-foreground">Recently visited</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visitedSites.map((site) => (
                <button
                  key={site.url}
                  type="button"
                  onClick={() => onNavigate(site.url)}
                  title={site.url}
                  className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-muted"
                >
                  <VisitedSiteIcon site={site} />
                  <span className="min-w-0 truncate text-xs text-foreground">{site.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
