import { listAvailableSkills } from '../skills/service'
import { getStoredSettings, updateStoredSettings } from '../settings/store'
import type { CliSessionState, SlashCommandHelpers } from './types'

export function buildDisabledSkillsByPath(
  current: Readonly<Record<string, boolean>>,
  availablePaths: readonly string[],
  selectedPaths: ReadonlySet<string>,
): Record<string, boolean> {
  const next = { ...current }
  for (const location of availablePaths) {
    if (selectedPaths.has(location)) delete next[location]
    else next[location] = true
  }
  return next
}

export async function runCliSkillsCommand(state: CliSessionState, helpers: SlashCommandHelpers): Promise<void> {
  const [skillsState, settings] = await Promise.all([
    listAvailableSkills(state.workspaceRootPath),
        getStoredSettings('cli'),
  ])
  if (skillsState.errorMessage) helpers.renderWarning(skillsState.errorMessage)
  if (skillsState.skills.length === 0) {
    helpers.renderInfo('No skills are available for this workspace.')
    return
  }

  const selectedPaths = await helpers.checklist<string>({
    title: 'Available Skills',
    items: skillsState.skills.map((skill) => ({
      value: skill.location,
      label: skill.name,
      description: `${skill.sourceLabel} · ${skill.description}`,
      enabled: settings.disabledSkillsByPath[skill.location] !== true,
    })),
    pageSize: 10,
        footer: 'Skill availability is shared across TideCode',
  })
  if (!selectedPaths) return

  const selected = new Set(selectedPaths)
  const disabledSkillsByPath = buildDisabledSkillsByPath(
    settings.disabledSkillsByPath,
    skillsState.skills.map((skill) => skill.location),
    selected,
  )
    await updateStoredSettings({ disabledSkillsByPath }, 'cli')
  helpers.renderSuccess(`Saved ${selected.size} enabled skill${selected.size === 1 ? '' : 's'}.`)
}
