import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function SettingsRowSkeleton({ controlWidth, descriptionWidth }: { controlWidth: string; descriptionWidth: string }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-6 md:px-5">
      <div className="min-w-0 flex-1">
        <SettingsSkeletonBlock className="h-4 w-36" />
        <SettingsSkeletonBlock className={`mt-2 h-3 ${descriptionWidth} max-w-full`} />
      </div>
      <SettingsSkeletonBlock className={`h-10 w-full shrink-0 rounded-xl ${controlWidth}`} />
    </div>
  )
}

function SectionTitleSkeleton({ width }: { width: string }) {
  return <SettingsSkeletonBlock className={`mb-3 h-6 ${width}`} />
}

export function GeneralSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading general settings">
      <div className="flex flex-col gap-5">
        <section>
          <SectionTitleSkeleton width="w-28" />
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <SettingsRowSkeleton controlWidth="md:w-52" descriptionWidth="w-4/5" />
          </div>
        </section>
        <section>
          <SectionTitleSkeleton width="w-32" />
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <SettingsRowSkeleton controlWidth="md:w-60" descriptionWidth="w-3/4" />
            <div className="border-t border-border"><SettingsRowSkeleton controlWidth="md:w-48" descriptionWidth="w-11/12" /></div>
            <div className="border-t border-border"><SettingsRowSkeleton controlWidth="md:w-40" descriptionWidth="w-2/3" /></div>
            <div className="border-t border-border"><SettingsRowSkeleton controlWidth="md:w-40" descriptionWidth="w-4/5" /></div>
          </div>
        </section>
      </div>
    </SettingsSkeletonPanel>
  )
}
