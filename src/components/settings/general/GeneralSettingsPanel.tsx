import { memo, useCallback } from 'react'
import {
  APP_APPEARANCE_OPTIONS,
  APP_LANGUAGE_OPTIONS,
  FOLLOW_UP_BEHAVIOR_OPTIONS,
  isAppAppearance,
  isAppLanguage,
  isFollowUpBehavior,
} from '../../../lib/appSettings'
import type { AppAppearance, AppLanguage, FollowUpBehavior } from '../../../lib/appSettings'
import type { AppSettings } from '../../../types/chat'
import { DropdownField } from '../../ui/DropdownField'
import { SegmentedField } from '../../ui/SegmentedField'
import { SettingsPanelLayout, SettingsRow, SettingsSection } from '../shared/SettingsPanelPrimitives'
import { GeneralSettingsSkeleton } from './GeneralSettingsSkeleton'

const BOOLEAN_SEGMENT_OPTIONS = [
  { label: 'Off', value: 'off' },
  { label: 'On', value: 'on' },
] as const

interface GeneralSettingsPanelProps {
  isLoading: boolean
  onUpdateSettings: (input: Partial<AppSettings>) => void
  settings: {
    appearance: AppAppearance
    followUpBehavior: FollowUpBehavior
    language: AppLanguage
    sendMessageOnEnter: boolean
    workspaceFileEditorWordWrap: boolean
  }
}

export function GeneralSettingsPanel({
  isLoading,
  onUpdateSettings,
  settings,
}: GeneralSettingsPanelProps) {
  const handleAppearanceChange = useCallback(
    (nextValue: string) => {
      if (isAppAppearance(nextValue)) {
        onUpdateSettings({ appearance: nextValue })
      }
    },
    [onUpdateSettings],
  )

  const handleLanguageChange = useCallback(
    (nextValue: string) => {
      if (isAppLanguage(nextValue)) {
        onUpdateSettings({ language: nextValue })
      }
    },
    [onUpdateSettings],
  )

  const handleFollowUpBehaviorChange = useCallback(
    (nextValue: string) => {
      if (isFollowUpBehavior(nextValue)) {
        onUpdateSettings({ followUpBehavior: nextValue })
      }
    },
    [onUpdateSettings],
  )

  const handleWorkspaceWordWrapChange = useCallback(
    (nextValue: string) => {
      onUpdateSettings({ workspaceFileEditorWordWrap: nextValue === 'on' })
    },
    [onUpdateSettings],
  )

  const handleSendOnEnterChange = useCallback(
    (nextValue: string) => {
      onUpdateSettings({ sendMessageOnEnter: nextValue === 'on' })
    },
    [onUpdateSettings],
  )

  if (isLoading) {
    return <GeneralSettingsSkeleton />
  }

  return (
    <SettingsPanelLayout>
      <SettingsSection title="Appearance">
        <SettingsRow
          title="Theme"
          description="Choose the app theme or follow your system appearance automatically."
        >
          <SegmentedField
            ariaLabel="App appearance"
            value={settings.appearance}
            options={APP_APPEARANCE_OPTIONS}
            disabled={isLoading}
            onChange={handleAppearanceChange}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Preferences">
        <SettingsRow
          title="Language"
          description="Set the interface language used for date and time labels across the app."
        >
          <div className="w-full md:w-[240px]">
            <label htmlFor="general-language" className="sr-only">
              App language
            </label>
            <DropdownField
              id="general-language"
              ariaLabel="App language"
              value={settings.language}
              options={APP_LANGUAGE_OPTIONS}
              disabled={isLoading}
              className="w-full"
              onChange={handleLanguageChange}
            />
          </div>
        </SettingsRow>

        <div className="border-t border-border">
          <SettingsRow
            title="Follow-up behavior"
            description="Queue waits for the full turn. Steer sends after the next successful tool call, or when the turn ends. During an active response, Enter uses this choice and Ctrl+Enter or Cmd+Enter uses the other."
          >
            <SegmentedField
              ariaLabel="Follow-up behavior"
              value={settings.followUpBehavior}
              options={FOLLOW_UP_BEHAVIOR_OPTIONS}
              disabled={isLoading}
              onChange={handleFollowUpBehaviorChange}
            />
          </SettingsRow>
        </div>

        <div className="border-t border-border">
          <SettingsRow
            title="Workspace editor word wrap"
            description="Wrap long lines in the workspace file editor."
          >
            <SegmentedField
              ariaLabel="Workspace editor word wrap"
              value={settings.workspaceFileEditorWordWrap ? 'on' : 'off'}
              options={BOOLEAN_SEGMENT_OPTIONS}
              disabled={isLoading}
              onChange={handleWorkspaceWordWrapChange}
            />
          </SettingsRow>
        </div>

        <div className="border-t border-border">
          <SettingsRow
            title="Send on Enter"
            description="Press Enter to send messages. When off, use Ctrl+Enter or Cmd+Enter to send."
          >
            <SegmentedField
              ariaLabel="Send on Enter"
              value={settings.sendMessageOnEnter ? 'on' : 'off'}
              options={BOOLEAN_SEGMENT_OPTIONS}
              disabled={isLoading}
              onChange={handleSendOnEnterChange}
            />
          </SettingsRow>
        </div>
      </SettingsSection>
    </SettingsPanelLayout>
  )
}

export const MemoizedGeneralSettingsPanel = memo(GeneralSettingsPanel)
