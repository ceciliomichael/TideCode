import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function SkillCardSkeleton({ descriptionWidth }: { descriptionWidth: string }) {
  return (
    <div className="min-h-[132px] rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SettingsSkeletonBlock className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 pt-0.5">
            <SettingsSkeletonBlock className="h-4 w-36 max-w-[60%]" />
            <SettingsSkeletonBlock className={`mt-2 h-3 ${descriptionWidth} max-w-full`} />
            <SettingsSkeletonBlock className="mt-2 h-3 w-3/5 max-w-full" />
            <SettingsSkeletonBlock className="mt-1 h-4 w-16 opacity-0" />
          </div>
        </div>
        <SettingsSkeletonBlock className="h-6 w-11 shrink-0 rounded-full" />
      </div>
    </div>
  )
}

export function SkillsSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading skills settings">
      <div className="flex flex-col gap-4">
        <header className="px-1 pt-1">
          <SettingsSkeletonBlock className="h-6 w-20" />
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-3.5 w-full max-w-[590px]" />
              <SettingsSkeletonBlock className="mt-2 h-3.5 w-4/5 max-w-[470px]" />
            </div>
            <SettingsSkeletonBlock className="h-11 w-full rounded-xl md:h-10 md:w-28" />
          </div>
        </header>
        <div className="flex flex-col gap-3">
          <SkillCardSkeleton descriptionWidth="w-5/6" />
          <SkillCardSkeleton descriptionWidth="w-3/4" />
          <SkillCardSkeleton descriptionWidth="w-11/12" />
        </div>
      </div>
    </SettingsSkeletonPanel>
  )
}
