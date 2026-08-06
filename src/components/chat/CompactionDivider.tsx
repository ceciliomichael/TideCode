import { useState } from 'react'
import { normalizeMarkdownText } from '../../lib/chatMessageContent'
import type { ChatCompactionMarker } from '../../types/chat'
import { MarkdownRenderer } from './MarkdownRenderer'

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
          disabled={isCompacting}
          aria-expanded={isOpen}
          aria-label={isCompacting ? 'Context compaction in progress' : 'Show compacted context details'}
          aria-live={isCompacting ? 'polite' : undefined}
          className={[
            'flex shrink-0 items-center text-subtle-foreground transition-colors',
            isCompacting ? 'cursor-default' : 'cursor-pointer hover:text-foreground',
          ].join(' ')}
          onClick={() => {
            if (!isCompacting) {
              setIsOpen((currentValue) => !currentValue)
            }
          }}
        >
          <span className={isCompacting ? 'thinking-shimmer' : undefined}>
            {isCompacting ? 'Compacting' : 'Compacted'}
          </span>
        </button>
        <div className="h-px flex-1 bg-border" />
      </div>

      {isOpen && marker && marker.detailSections.length > 0 ? (
        <div className="mx-auto mt-1.5 max-h-[min(70vh,36rem)] w-full max-w-3xl overflow-y-auto pr-1 text-sm text-muted-foreground/90">
          {marker.detailSections.map((section) => (
            <section key={section.label ?? 'details'} className="space-y-2">
              {section.label ? (
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-subtle-foreground">
                  {section.label}
                </h4>
              ) : null}
              <div className="space-y-3">
                {section.items.map((item) => (
                  <MarkdownRenderer
                    key={`${section.label ?? 'details'}-${item}`}
                    content={normalizeMarkdownText(item)}
                    className="w-full text-sm text-foreground/90"
                    preserveLineBreaks
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
