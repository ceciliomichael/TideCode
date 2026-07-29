import { Braces } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Switch } from '../../ui/Switch'
import type { SkillSummary } from '../../../types/skills'

interface SkillCardProps {
  isEnabled: boolean
  onToggle: (enabled: boolean) => void
  skill: SkillSummary
}

export function SkillCard({ isEnabled, onToggle, skill }: SkillCardProps) {
  const descriptionContainerRef = useRef<HTMLDivElement | null>(null)
  const descriptionMeasureRef = useRef<HTMLDivElement | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isExpandable, setIsExpandable] = useState(false)
  const actionClassName =
    'text-[11px] font-medium text-foreground transition-colors hover:text-foreground/70'
  const collapsedLineCount = 2
  const markdownComponents = useMemo(
    () => ({
      p: Fragment,
      strong: (props: React.ComponentPropsWithoutRef<'strong'>) => <strong {...props} className="font-semibold text-foreground" />,
      em: (props: React.ComponentPropsWithoutRef<'em'>) => <em {...props} className="italic" />,
      code: (props: React.ComponentPropsWithoutRef<'code'>) => (
        <code {...props} className="rounded bg-surface-muted px-1 py-0.5 text-[11px] text-foreground" />
      ),
      a: (props: React.ComponentPropsWithoutRef<'a'>) => (
        <a
          {...props}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        />
      ),
      ul: (props: React.ComponentPropsWithoutRef<'ul'>) => <ul {...props} className="my-0 ml-4 list-disc" />,
      ol: (props: React.ComponentPropsWithoutRef<'ol'>) => <ol {...props} className="my-0 ml-4 list-decimal" />,
      li: (props: React.ComponentPropsWithoutRef<'li'>) => <li {...props} className="my-0" />,
    }),
    [],
  )

  useEffect(() => {
    const descriptionContainer = descriptionContainerRef.current
    if (!descriptionContainer) {
      return
    }

    const updateDescriptionWidth = () => {
      const descriptionElement = descriptionMeasureRef.current
      if (!descriptionElement) {
        setIsExpandable(false)
        return
      }

      const lineHeight = Number.parseFloat(window.getComputedStyle(descriptionElement).lineHeight)
      const maxCollapsedHeight = Number.isFinite(lineHeight) ? lineHeight * collapsedLineCount : 60
      setIsExpandable(descriptionElement.scrollHeight > maxCollapsedHeight + 1)
    }

    updateDescriptionWidth()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateDescriptionWidth()
      })
      observer.observe(descriptionContainer)
      return () => {
        observer.disconnect()
      }
    }

    window.addEventListener('resize', updateDescriptionWidth)

    return () => {
      window.removeEventListener('resize', updateDescriptionWidth)
    }
  }, [collapsedLineCount, skill.description])

  return (
    <article className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="shrink-0 rounded-lg bg-surface-muted p-2">
            <Braces className="h-5 w-5 text-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-medium text-foreground">{skill.name}</h3>
            <div ref={descriptionContainerRef} className="relative mt-1">
              <div
                ref={descriptionMeasureRef}
                className={[
                  'break-words text-xs leading-5 text-muted-foreground',
                  isExpanded ? '' : 'line-clamp-2 overflow-hidden',
                ].join(' ')}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {skill.description}
                </ReactMarkdown>
              </div>

              {isExpandable ? (
                <button
                  type="button"
                  onClick={() => setIsExpanded((currentValue) => !currentValue)}
                  className="mt-1 text-left"
                >
                  <span className={actionClassName}>{isExpanded ? 'Show less' : 'Show more'}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          <Switch checked={isEnabled} label={`Enable ${skill.name}`} onChange={onToggle} />
        </div>
      </div>
    </article>
  )
}
