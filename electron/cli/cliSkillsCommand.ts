import { listAvailableSkills } from '../skills/service'
import type { CliSessionState, SlashCommandHelpers } from './types'

export async function runCliSkillsCommand(state: CliSessionState, helpers: SlashCommandHelpers): Promise<void> {
  const skillsState = await listAvailableSkills(state.workspaceRootPath)
  if (skillsState.errorMessage) helpers.renderWarning(skillsState.errorMessage)
  if (skillsState.skills.length === 0) {
    helpers.renderInfo('No skills are available for this workspace.')
    return
  }

  helpers.renderInfo(
    skillsState.skills
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n'),
  )
}
