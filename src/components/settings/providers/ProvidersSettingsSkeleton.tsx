import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function ProviderCardSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-surface p-4 md:px-5">
      <SettingsSkeletonBlock className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
        <div className="min-w-0 flex-1">
          <SettingsSkeletonBlock className={`h-4 ${titleWidth}`} />
          <SettingsSkeletonBlock className="mt-2 h-3 w-4/5 max-w-full" />
        </div>
        <SettingsSkeletonBlock className="mt-3 h-3 w-20 shrink-0 md:mt-0" />
      </div>
    </div>
  )
}

export function ProvidersSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading provider settings">
      <div className="flex flex-col gap-4">
        <header className="px-1 pt-1">
          <SettingsSkeletonBlock className="h-6 w-24" />
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-3.5 w-full max-w-[560px]" />
              <SettingsSkeletonBlock className="mt-2 h-3.5 w-3/4 max-w-[430px]" />
            </div>
            <SettingsSkeletonBlock className="h-11 w-full rounded-xl md:h-10 md:w-44" />
          </div>
        </header>
        <div className="flex flex-col gap-2.5">
          <ProviderCardSkeleton titleWidth="w-20" />
          <ProviderCardSkeleton titleWidth="w-24" />
          <ProviderCardSkeleton titleWidth="w-16" />
          <ProviderCardSkeleton titleWidth="w-28" />
        </div>
      </div>
    </SettingsSkeletonPanel>
  )
}
