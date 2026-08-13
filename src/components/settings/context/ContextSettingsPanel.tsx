import { memo, useCallback } from 'react'
import { DropdownField } from '../../ui/DropdownField'
import type { AppSettings } from '../../../types/chat'
import {
  CONTEXT_COMPACTION_LIMITS,
  mergeContextCompactionSettings,
  type ContextCompactionSettings,
} from '../../../lib/contextCompactionSettings'
import { SettingsPanelLayout, SettingsRow, SettingsSection } from '../shared/SettingsPanelPrimitives'

const CONTEXT_WINDOW_OPTIONS = [
  { label: '16,000 tokens', value: '16000' },
  { label: '32,000 tokens', value: '32000' },
  { label: '64,000 tokens', value: '64000' },
  { label: '128,000 tokens', value: '128000' },
  { label: '200,000 tokens', value: '200000' },
  { label: '256,000 tokens', value: '256000' },
  { label: '400,000 tokens', value: '400000' },
  { label: '512,000 tokens', value: '512000' },
  { label: '1,000,000 tokens', value: '1000000' },
  { label: '2,000,000 tokens', value: '2000000' },
] as const

const RETAINED_TURN_OPTIONS = [
  { label: '1 turn', value: '1' },
  { label: '2 turns', value: '2' },
  { label: '3 turns', value: '3' },
  { label: '4 turns', value: '4' },
  { label: '5 turns', value: '5' },
  { label: '6 turns', value: '6' },
  { label: '7 turns', value: '7' },
  { label: '8 turns', value: '8' },
  { label: '9 turns', value: '9' },
  { label: '10 turns', value: '10' },
  { label: '11 turns', value: '11' },
  { label: '12 turns', value: '12' },
] as const

function formatPercent(value: number) {
  return `${value}%`
}

interface ContextSettingsPanelProps {
  isLoading: boolean
  onUpdateSettings: (input: Partial<AppSettings>) => void
  settings: ContextCompactionSettings
}

export function ContextSettingsSections({ isLoading, onUpdateSettings, settings }: ContextSettingsPanelProps) {
  const updateContextSettings = useCallback(
    (patch: Partial<ContextCompactionSettings>) => {
      onUpdateSettings({
        contextCompaction: mergeContextCompactionSettings(settings, patch),
      })
    },
    [onUpdateSettings, settings],
  )
  return (
    <>
      <SettingsSection title="Context budget">
        <SettingsRow
          title="Maximum context"
          description="The context budget used by the indicator and automatic compaction. Keep this at or below the selected model's supported limit."
        >
          <div className="w-full md:w-[240px]">
            <label htmlFor="context-window-size" className="sr-only">
              Maximum context
            </label>
            <DropdownField
              id="context-window-size"
              ariaLabel="Maximum context"
              value={String(settings.contextWindowTokens)}
              options={CONTEXT_WINDOW_OPTIONS}
              disabled={isLoading}
              className="w-full"
              onChange={(value) => updateContextSettings({ contextWindowTokens: Number(value) })}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title="Latest turns to keep"
          description="Keep this many complete recent turns alongside the new compaction summary."
        >
          <div className="w-full md:w-[240px]">
            <label htmlFor="compaction-retained-turns" className="sr-only">
              Latest turns to keep
            </label>
            <DropdownField
              id="compaction-retained-turns"
              ariaLabel="Latest turns to keep"
              value={String(settings.retainedTurnCount)}
              options={RETAINED_TURN_OPTIONS}
              disabled={isLoading}
              className="w-full"
              onChange={(value) => updateContextSettings({ retainedTurnCount: Number(value) })}
            />
          </div>
        </SettingsRow>

        <div className="border-t border-border">
          <SettingsRow
            title="Automatic compaction trigger"
            description="Start compacting when the estimated context reaches this percentage of the maximum."
          >
            <div className="w-full md:w-[240px]">
              <div className="flex items-center gap-3">
                <input
                  aria-label="Automatic compaction trigger"
                  className="min-w-0 flex-1 accent-action"
                  disabled={isLoading}
                  max={CONTEXT_COMPACTION_LIMITS.triggerPercent.maximum}
                  min={CONTEXT_COMPACTION_LIMITS.triggerPercent.minimum}
                  onChange={(event) => updateContextSettings({ triggerPercent: Number(event.target.value) })}
                  step="1"
                  type="range"
                  value={settings.triggerPercent}
                />
                <output className="w-12 text-right text-sm font-medium text-foreground">
                  {formatPercent(settings.triggerPercent)}
                </output>
              </div>
            </div>
          </SettingsRow>
        </div>

      </SettingsSection>
    </>
  )
}

export function ContextSettingsPanel(props: ContextSettingsPanelProps) {
  return (
    <SettingsPanelLayout>
      <ContextSettingsSections {...props} />
    </SettingsPanelLayout>
  )
}

export const MemoizedContextSettingsSections = memo(ContextSettingsSections)
export const MemoizedContextSettingsPanel = memo(ContextSettingsPanel)
