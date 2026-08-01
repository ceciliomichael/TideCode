import type { ReactNode } from 'react'

export const SETTINGS_SECTION_TITLE_CLASS_NAME =
  'text-[18px] font-semibold tracking-tight text-brand md:text-[20px]'

interface SettingsPanelLayoutProps {
  children: ReactNode
}

interface SettingsSectionProps {
  children: ReactNode
  title: string
}

interface SettingsRowProps {
  children: ReactNode
  description: string
  title: string
}

export function SettingsPanelLayout({ children }: SettingsPanelLayoutProps) {
  return <div className="mb-8 flex w-full max-w-[780px] flex-col gap-5 md:mb-10">{children}</div>
}

export function SettingsSection({ children, title }: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>{title}</h3>
      </header>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">{children}</div>
    </section>
  )
}

export function SettingsRow({ children, description, title }: SettingsRowProps) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-6 md:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground md:text-sm">{title}</p>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground md:text-sm">{description}</p>
      </div>

      {children}
    </div>
  )
}
