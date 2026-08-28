import type { SkillSummary } from '../../../types/skills'
import { SkillCard } from './SkillCard'

interface SkillListProps {
  onSelectSkill: (skill: SkillSummary) => void
  skills: SkillSummary[]
}

export function SkillList({ onSelectSkill, skills }: SkillListProps) {
  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-surface px-4 py-12 text-center">
        <p className="text-sm font-medium text-foreground">No skills discovered</p>
        <p className="max-w-md text-xs leading-6 text-muted-foreground">
          Add `SKILL.md` files to your workspace `skills/` folder or your home profile skill directories to make them
          available here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {skills.map((skill) => (
        <SkillCard key={skill.id} onClick={() => onSelectSkill(skill)} skill={skill} />
      ))}
    </div>
  )
}
