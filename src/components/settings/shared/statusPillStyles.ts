export type StatusPillTone = 'active' | 'inactive'

const baseStatusPillClassName = 'rounded-full px-2.5 py-1 text-[11px] font-medium'

const statusToneClassNameMap: Record<StatusPillTone, string> = {
  active: 'bg-[var(--segmented-control-active-surface)] text-brand-soft-foreground',
  inactive: 'bg-[var(--segmented-control-hover-surface)] text-muted-foreground',
}

export function getStatusPillClassName(tone: StatusPillTone): string {
  return `${baseStatusPillClassName} ${statusToneClassNameMap[tone]}`
}
