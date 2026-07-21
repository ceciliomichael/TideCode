import { jsonSchema, tool } from 'ai'
import type { SkillSummary } from '../../../../src/types/skills'
import { buildLoadedSkillResult, buildSkillToolDescription, loadEnabledSkillByName } from '../../../skills/service'
import type { WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export function createSkillTool(context: WorkspaceToolContext, enabledSkills: SkillSummary[]) {
  return tool({
    description: buildSkillToolDescription(enabledSkills),
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        name: { enum: enabledSkills.map((skill) => skill.name), type: 'string' },
      },
      required: ['name'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as { name: string }
      try {
        const loadedSkill = await loadEnabledSkillByName(input.name, context.workspaceRootPath, enabledSkills)
        if (!loadedSkill) {
          return createToolErrorResult(
            `Skill "${input.name}" is unavailable.`,
            `Available skills: ${enabledSkills.map((skill) => skill.name).join(', ') || 'none'}`,
          )
        }
        return buildLoadedSkillResult(loadedSkill)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Unable to load the skill.'))
      }
    },
  })
}
