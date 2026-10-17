import { jsonSchema, tool } from 'ai'
import { getSkillAliasDirectory, paginateSkills, type SkillSummary } from '../shared'

export function createSkillListApi(enabledSkills: SkillSummary[]) {
  return tool({
    description: 'List the enabled skills, ten per page.',
    inputSchema: jsonSchema({ type: 'object', properties: { page: { type: 'integer', minimum: 1 } }, additionalProperties: false }),
    execute: async (input) => {
      const pagination = paginateSkills(enabledSkills, (input as { page?: number }).page ?? 1, 10)
      return { status: 'success' as const, summary: `Listed ${pagination.items.length} skills (page ${pagination.currentPage}/${pagination.totalPages})`, body: pagination.items.map((skill) => `${skill.name}: ${skill.description} (${getSkillAliasDirectory(skill)})`).join('\n') || 'No enabled skills on this page.' }
    },
  })
}
