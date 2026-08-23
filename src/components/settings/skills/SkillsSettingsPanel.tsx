import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { SettingsPanelLayout, SETTINGS_SECTION_TITLE_CLASS_NAME } from '../shared/SettingsPanelPrimitives'
import { SkillAddDialog } from './SkillAddDialog'
import { SkillList } from './SkillList'
import { SkillsSettingsSkeleton } from './SkillsSettingsSkeleton'
import type { AppSettings } from '../../../types/chat'
import type { CreateSkillInput, SkillSummary, SkillsState } from '../../../types/skills'

const ADD_SKILL_BUTTON_CLASS_NAME =
  'provider-primary-action-button inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:w-auto'

interface SkillsSettingsPanelProps {
  errorMessage: string | null
  isLoading: boolean
  onCreateSkill: (input: CreateSkillInput) => Promise<boolean>
  onUpdateSettings: (input: Partial<AppSettings>) => void
  settings: Pick<AppSettings, 'disabledSkillsByPath'>
  state: SkillsState | null
}

function getNextDisabledSkillsByPath(
  currentValue: Record<string, boolean>,
  skill: SkillSummary,
  enabled: boolean,
) {
  const nextValue = { ...currentValue }
  if (enabled) {
    delete nextValue[skill.location]
  } else {
    nextValue[skill.location] = true
  }

  return nextValue
}

export function SkillsSettingsPanel({
  errorMessage,
  isLoading,
  onCreateSkill,
  onUpdateSettings,
  settings,
  state,
}: SkillsSettingsPanelProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleToggleSkill = useCallback(
    (skill: SkillSummary, enabled: boolean) => {
      onUpdateSettings({
        disabledSkillsByPath: getNextDisabledSkillsByPath(settings.disabledSkillsByPath, skill, enabled),
      })
    },
    [onUpdateSettings, settings.disabledSkillsByPath],
  )

  const handleCreateSkill = async (input: CreateSkillInput) => {
    setIsSubmitting(true)
    try {
      return await onCreateSkill(input)
    } finally {
      setIsSubmitting(false)
    }
  }

  const rawErrorMessage = errorMessage ?? state?.errorMessage ?? null
  const visibleErrorMessage = rawErrorMessage
    ? toUserFacingErrorMessage(rawErrorMessage, 'Unable to load skills.')
    : null

  if (isLoading && state === null && visibleErrorMessage === null) {
    return <SkillsSettingsSkeleton />
  }

  return (
    <SettingsPanelLayout>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1 pt-1">
          <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>Skills</h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
              Skills are reusable instruction packs for specific workflows. Keep a skill enabled if you want the assistant
              to recognize it and load its guidance when it fits the task.
            </p>
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              disabled={isLoading}
              className={`${ADD_SKILL_BUTTON_CLASS_NAME} md:shrink-0`}
            >
              <Plus size={15} /> Add Skill
            </button>
          </div>
        </header>

        {visibleErrorMessage ? (
          <div className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
            {visibleErrorMessage}
          </div>
        ) : null}

        {state ? (
          <SkillList
            disabledSkillsByPath={settings.disabledSkillsByPath}
            onToggleSkill={handleToggleSkill}
            skills={state.skills}
          />
        ) : null}
      </div>

      {isDialogOpen ? (
        <SkillAddDialog
          errorMessage={visibleErrorMessage}
          isSubmitting={isSubmitting}
          onClose={() => setIsDialogOpen(false)}
          onSubmit={handleCreateSkill}
        />
      ) : null}
    </SettingsPanelLayout>
  )
}
