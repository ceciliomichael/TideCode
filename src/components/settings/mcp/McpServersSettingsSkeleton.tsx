import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function McpServerCardSkeleton({ nameWidth }: { nameWidth: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SettingsSkeletonBlock className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 pt-0.5">
            <SettingsSkeletonBlock className={`h-4 ${nameWidth}`} />
            <SettingsSkeletonBlock className="mt-2 h-3 w-3/4 max-w-full" />
            <div className="mt-3 flex items-center gap-2">
              <SettingsSkeletonBlock className="h-2 w-2 rounded-full" />
              <SettingsSkeletonBlock className="h-3 w-20" />
            </div>
          </div>
        </div>
        <SettingsSkeletonBlock className="h-8 w-[88px] shrink-0 rounded-xl" />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <SettingsSkeletonBlock className="h-3 w-20" />
        <div className="flex gap-2">
          <SettingsSkeletonBlock className="h-8 w-[76px] rounded-xl" />
          <SettingsSkeletonBlock className="h-8 w-16 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export function McpServersSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading MCP server settings">
      <div className="flex flex-col gap-4">
        <header className="px-1 pt-1">
          <SettingsSkeletonBlock className="h-6 w-32" />
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-3.5 w-full max-w-[570px]" />
              <SettingsSkeletonBlock className="mt-2 h-3.5 w-4/5 max-w-[450px]" />
            </div>
            <SettingsSkeletonBlock className="h-11 w-full rounded-xl md:h-10 md:w-24" />
          </div>
        </header>
        <div className="flex flex-col gap-3">
          <McpServerCardSkeleton nameWidth="w-32" />
          <McpServerCardSkeleton nameWidth="w-44" />
        </div>
      </div>
    </SettingsSkeletonPanel>
  )
}
