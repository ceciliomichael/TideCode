import type { ReactNode } from 'react'
import { SettingsPanelLayout } from './SettingsPanelPrimitives'

interface SettingsSkeletonBlockProps {
  className: string
}

interface SettingsSkeletonPanelProps {
  children: ReactNode
  label: string
}

export function SettingsSkeletonBlock({ className }: SettingsSkeletonBlockProps) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-lg bg-surface-muted motion-reduce:animate-none ${className}`}
    />
  )
}

export function SettingsSkeletonPanel({ children, label }: SettingsSkeletonPanelProps) {
  return (
    <SettingsPanelLayout>
      <div aria-label={label} aria-live="polite" role="status">
        <div aria-hidden="true">{children}</div>
      </div>
    </SettingsPanelLayout>
  )
}
