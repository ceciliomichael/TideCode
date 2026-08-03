import { useState } from 'react'
import type { ChatCompactionMarker } from '../../types/chat'

interface CompactionDividerProps {
  marker?: ChatCompactionMarker
  phase?: 'compacting' | 'compacted'
}

export function CompactionDivider({ marker, phase = 'compacted' }: CompactionDividerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const isCompacting = phase === 'compacting'

  return (
    <div className="w-full">
      <div className="flex w-full items-center gap-3 text-[10px] font-medium uppercase tracking-[0.16em] text-subtle-foreground">
        <div className="h-px flex-1 bg-border" />
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={isCompacting ? 'Context compaction in progress' : 'Show compacted context details'}
          aria-live={isCompacting ? 'polite' : undefined}
          className="flex shrink-0 items-center text-subtle-foreground transition-colors hover:text-foreground"
          onClick={() => {
            if (!isCompacting) {
              setIsOpen((currentValue) => !currentValue)
            }
          }}
        >
          <span>{isCompacting ? 'Compacting' : 'Compacted'}</span>
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>

      {isOpen && marker && marker.detailSections.length > 0 ? (
        <div className="mx-auto mt-1.5 w-full max-w-3xl space-y-3 text-sm text-muted-foreground/90">
          {marker.detailSections.map((section) => (
            <section key={section.label} className="space-y-1.5">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle-foreground">
                {section.label}
              </h4>
              <ul className="list-disc space-y-1 pl-5">
                {section.items.map((item) => (
                  <li key={`${section.label}-${item}`} className="leading-5">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
