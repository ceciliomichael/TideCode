import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { SettingsPanelLayout, SETTINGS_SECTION_TITLE_CLASS_NAME } from '../shared/SettingsPanelPrimitives'
import { SkillAddDialog } from './SkillAddDialog'
import { SkillList } from './SkillList'
import { SkillsSettingsSkeleton } from './SkillsSettingsSkeleton'
import type { CreateSkillInput, SkillSummary, SkillsState } from '../../../types/skills'

const ADD_SKILL_BUTTON_CLASS_NAME =
  'provider-primary-action-button inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:w-auto'

interface SkillsSettingsPanelProps {
  errorMessage: string | null
  isLoading: boolean
  onCreateSkill: (input: CreateSkillInput) => Promise<boolean>
  onLoadSkill: (skill: SkillSummary) => Promise<CreateSkillInput | null>
  onUpdateSkill: (skill: SkillSummary, input: CreateSkillInput) => Promise<boolean>
  state: SkillsState | null
}

export function SkillsSettingsPanel({
  errorMessage,
  isLoading,
  onCreateSkill,
  onLoadSkill,
  onUpdateSkill,
  state,
}: SkillsSettingsPanelProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isLoadingSkill, setIsLoadingSkill] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillSummary | null>(null)
  const [editingValues, setEditingValues] = useState<CreateSkillInput | null>(null)

  const handleSkillSubmit = async (input: CreateSkillInput) => {
    setIsSubmitting(true)
    try {
      return editingSkill ? await onUpdateSkill(editingSkill, input) : await onCreateSkill(input)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenAddDialog = () => {
    setEditingSkill(null)
    setEditingValues(null)
    setIsDialogOpen(true)
  }

  const handleSelectSkill = async (skill: SkillSummary) => {
    if (isLoadingSkill) {
      return
    }

    setIsLoadingSkill(true)
    try {
      const initialValues = await onLoadSkill(skill)
      if (!initialValues) {
        return
      }

      setEditingSkill(skill)
      setEditingValues(initialValues)
      setIsDialogOpen(true)
    } finally {
      setIsLoadingSkill(false)
    }
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setEditingSkill(null)
    setEditingValues(null)
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
              Skills are reusable instruction packs for specific workflows. All discovered skills are available
              automatically when they fit the task.
            </p>
            <button
              type="button"
              onClick={handleOpenAddDialog}
              disabled={isLoading || isLoadingSkill}
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
          <SkillList onSelectSkill={handleSelectSkill} skills={state.skills} />
        ) : null}
      </div>

      {isDialogOpen ? (
        <SkillAddDialog
          key={editingSkill?.id ?? 'add-skill'}
          errorMessage={visibleErrorMessage}
          initialValues={editingValues ?? undefined}
          isSubmitting={isSubmitting}
          mode={editingSkill ? 'edit' : 'add'}
          onClose={handleCloseDialog}
          onSubmit={handleSkillSubmit}
        />
      ) : null}
    </SettingsPanelLayout>
  )
}
