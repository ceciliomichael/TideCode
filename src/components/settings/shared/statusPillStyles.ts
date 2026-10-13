export type StatusPillTone = 'active' | 'inactive'

const baseStatusPillClassName = 'rounded-full px-2.5 py-1 text-[11px] font-medium'

const statusToneClassNameMap: Record<StatusPillTone, string> = {
  active: 'border border-brand-border bg-brand-soft text-brand-soft-foreground',
  inactive: 'border border-border-muted bg-surface-muted text-muted-foreground',
}

export function getStatusPillClassName(tone: StatusPillTone): string {
  return `${baseStatusPillClassName} ${statusToneClassNameMap[tone]}`
}
