interface PlanStatusDividerProps {
  label: string
}

export function PlanStatusDivider({ label }: PlanStatusDividerProps) {
  return (
    <div className="w-full">
      <div className="flex w-full items-center gap-3 text-[10px] font-medium uppercase tracking-[0.16em] text-subtle-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>{label}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
