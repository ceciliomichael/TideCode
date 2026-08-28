import { ChevronRight } from 'lucide-react'
import type { SkillSummary } from '../../../types/skills'

interface SkillCardProps {
  onClick: () => void
  skill: SkillSummary
}

export function SkillCard({ onClick, skill }: SkillCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-20 w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left transition-[transform,border-color,background-color] hover:-translate-y-0.5 hover:bg-surface-muted active:translate-y-0 md:px-5"
    >
      <span className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{skill.name}</span>
          <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground md:line-clamp-1">
            {skill.description}
          </span>
        </span>
        <span className="mt-2 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand md:mt-0">
          Edit setup
          <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  )
}
