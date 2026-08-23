import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function TaskModelRowSkeleton({ descriptionWidth }: { descriptionWidth: string }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-6 md:px-5">
      <div className="min-w-0 flex-1">
        <SettingsSkeletonBlock className="h-4 w-40" />
        <SettingsSkeletonBlock className={`mt-2 h-3 ${descriptionWidth} max-w-full`} />
      </div>
      <SettingsSkeletonBlock className="h-11 w-full shrink-0 rounded-xl md:h-10 md:w-[252px]" />
    </div>
  )
}

function TaskModelSectionSkeleton({ rows, titleWidth }: { rows: string[]; titleWidth: string }) {
  return (
    <section>
      <SettingsSkeletonBlock className={`mb-3 h-6 ${titleWidth}`} />
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {rows.map((descriptionWidth, index) => (
          <div key={`${descriptionWidth}-${index}`} className={index === 0 ? '' : 'border-t border-border'}>
            <TaskModelRowSkeleton descriptionWidth={descriptionWidth} />
          </div>
        ))}
      </div>
    </section>
  )
}

export function TaskModelsSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading task model settings">
      <div className="flex flex-col gap-5">
        <TaskModelSectionSkeleton titleWidth="w-32" rows={['w-4/5', 'w-11/12', 'w-3/4', 'w-5/6', 'w-4/5']} />
        <TaskModelSectionSkeleton titleWidth="w-36" rows={['w-11/12', 'w-4/5']} />
      </div>
    </SettingsSkeletonPanel>
  )
}
