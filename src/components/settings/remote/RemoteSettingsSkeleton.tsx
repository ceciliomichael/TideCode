import { SettingsSkeletonBlock, SettingsSkeletonPanel } from '../shared/SettingsSkeletonPrimitives'

function RemoteSectionShell({ children, titleWidth }: { children: React.ReactNode; titleWidth: string }) {
  return (
    <section>
      <SettingsSkeletonBlock className={`mb-3 h-6 ${titleWidth}`} />
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">{children}</div>
    </section>
  )
}

export function RemoteSettingsSkeleton() {
  return (
    <SettingsSkeletonPanel label="Loading remote access settings">
      <div className="flex flex-col gap-5">
        <RemoteSectionShell titleWidth="w-36">
          <div className="flex items-start gap-3 px-4 py-4 md:px-5">
            <SettingsSkeletonBlock className="h-5 w-5 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-4 w-24" />
              <SettingsSkeletonBlock className="mt-2 h-3 w-4/5 max-w-full" />
              <SettingsSkeletonBlock className="mt-3 h-3 w-32" />
            </div>
          </div>
        </RemoteSectionShell>
        <RemoteSectionShell titleWidth="w-40">
          {[0, 1].map((index) => (
            <div key={index} className={`flex items-center justify-between gap-3 px-4 py-3.5 md:px-5 ${index ? 'border-t border-border' : ''}`}>
              <div className="min-w-0 flex-1">
                <SettingsSkeletonBlock className="h-4 w-56 max-w-[80%]" />
                <SettingsSkeletonBlock className="mt-2 h-3 w-32" />
              </div>
              <SettingsSkeletonBlock className="h-8 w-8 shrink-0 rounded-lg" />
            </div>
          ))}
        </RemoteSectionShell>
        <RemoteSectionShell titleWidth="w-24">
          <div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-4 w-28" />
              <SettingsSkeletonBlock className="mt-2 h-3 w-4/5 max-w-full" />
            </div>
            <SettingsSkeletonBlock className="h-10 w-full rounded-xl md:w-[300px]" />
          </div>
        </RemoteSectionShell>
        <RemoteSectionShell titleWidth="w-48">
          <div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5">
            <div className="min-w-0 flex-1">
              <SettingsSkeletonBlock className="h-4 w-48" />
              <SettingsSkeletonBlock className="mt-2 h-3 w-11/12 max-w-full" />
            </div>
            <SettingsSkeletonBlock className="h-10 w-full rounded-xl md:w-40" />
          </div>
          <div className="border-t border-border px-4 py-4 md:px-5">
            <SettingsSkeletonBlock className="h-4 w-40" />
            <SettingsSkeletonBlock className="mt-2 h-3 w-3/4 max-w-full" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SettingsSkeletonBlock className="h-10 w-full rounded-xl md:col-span-2" />
              <SettingsSkeletonBlock className="h-10 w-full rounded-xl" />
              <SettingsSkeletonBlock className="h-10 w-full rounded-xl" />
            </div>
          </div>
        </RemoteSectionShell>
      </div>
    </SettingsSkeletonPanel>
  )
}
