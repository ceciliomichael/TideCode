import { useState } from 'react'
import type { ChatCompactionMarker } from '../../types/chat'

interface CompactionDividerProps {
  marker: ChatCompactionMarker
}

export function CompactionDivider({ marker }: CompactionDividerProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="w-full py-3">
      <div className="flex w-full items-center gap-3 text-[10px] font-medium uppercase tracking-[0.16em] text-subtle-foreground">
        <div className="h-px flex-1 bg-border" />
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label="Show compacted context details"
          className="flex shrink-0 items-center text-subtle-foreground transition-colors hover:text-foreground"
          onClick={() => setIsOpen((currentValue) => !currentValue)}
        >
          <span>Compacted</span>
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>

      {isOpen && marker.detailSections.length > 0 ? (
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
