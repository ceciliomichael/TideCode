import { Search, X } from 'lucide-react'

interface SidebarThreadSearchProps {
  onChange: (value: string) => void
  value: string
}

export function SidebarThreadSearch({ onChange, value }: SidebarThreadSearchProps) {
  return (
    <label className="relative block">
      <span className="sr-only">Search threads and projects</span>
      <Search
        size={16}
        strokeWidth={2}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search threads and projects"
        className="h-10 w-full rounded-xl border border-border bg-[var(--sidebar-raised-surface)] pl-9 pr-10 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
      />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear thread search"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground"
        >
          <X size={15} strokeWidth={2.2} />
        </button>
      ) : null}
    </label>
  )
}
