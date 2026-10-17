import { jsonSchema, tool } from 'ai'
import { buildLoadedSkillResult, loadEnabledSkillByName, type SkillSummary, type WorkspaceToolContext } from '../shared'

export function createSkillLoadApi(context: WorkspaceToolContext, enabledSkills: SkillSummary[]) {
  return tool({
    description: 'Load the full SKILL.md instructions for one exact enabled skill.',
    inputSchema: jsonSchema({ type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false }),
    execute: async (input) => {
      const name = (input as { name: string }).name.trim()
      if (!name) return { status: 'error' as const, summary: 'Skill name is required.', body: 'Provide the exact skill name.' }
      try {
        const skill = await loadEnabledSkillByName(name, context.workspaceRootPath, enabledSkills)
        return skill ? buildLoadedSkillResult(skill) : { status: 'error' as const, summary: `Skill ${name} is unavailable.`, body: 'Use tools.skill.search or tools.skill.list to discover enabled skills.' }
      } catch (error) {
        return { status: 'error' as const, summary: 'Unable to load skill.', body: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
