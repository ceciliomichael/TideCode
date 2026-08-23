import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function ModelRowSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
      <div className="min-w-0 flex-1">
        <SettingsSkeletonBlock className={`h-4 ${labelWidth}`} />
        <SettingsSkeletonBlock className="mt-2 h-3 w-40 max-w-[70%]" />
      </div>
      <SettingsSkeletonBlock className="h-6 w-11 shrink-0 rounded-full" />
    </div>
  )
}

export function ModelsSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading model settings">
      <div className="flex flex-col gap-3">
        <header className="px-1 pt-1">
          <SettingsSkeletonBlock className="h-6 w-20" />
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-3.5 w-full max-w-[560px]" />
              <SettingsSkeletonBlock className="mt-2 h-3.5 w-2/3 max-w-[390px]" />
            </div>
            <SettingsSkeletonBlock className="h-11 w-full rounded-xl md:h-10 md:w-28" />
          </div>
        </header>
        <section className="min-h-[280px] overflow-hidden rounded-xl border border-border bg-surface md:min-h-[360px]">
          <div className="border-b border-border px-4 py-3 md:px-5">
            <SettingsSkeletonBlock className="h-11 w-full rounded-xl md:h-10" />
          </div>
          <div className="flex items-center justify-between gap-3 bg-surface-muted px-4 py-3 md:px-5">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-4 w-28" />
              <SettingsSkeletonBlock className="mt-2 hidden h-3 w-64 max-w-[70%] sm:block" />
            </div>
            <SettingsSkeletonBlock className="h-7 w-20 rounded-lg" />
          </div>
          <ModelRowSkeleton labelWidth="w-36" />
          <ModelRowSkeleton labelWidth="w-44" />
          <ModelRowSkeleton labelWidth="w-28" />
        </section>
      </div>
    </SettingsSkeletonPanel>
  )
}
