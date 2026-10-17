import { jsonSchema, tool } from 'ai'
import { getSkillAliasDirectory, searchSkills, type SkillSummary } from '../shared'

export function createSkillSearchApi(enabledSkills: SkillSummary[]) {
  return tool({
    description: 'Search enabled skills by name or description.',
    inputSchema: jsonSchema({ type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false }),
    execute: async (input) => {
      const query = (input as { query: string }).query.trim()
      if (!query) return { status: 'error' as const, summary: 'Search query is required.', body: 'Provide a nonempty query.' }
      const matches = searchSkills(enabledSkills, query)
      return { status: 'success' as const, summary: `Found ${matches.length} matching skills`, body: matches.map((skill) => `${skill.name}: ${skill.description} (${getSkillAliasDirectory(skill)})`).join('\n') || 'No matching enabled skills.' }
    },
  })
}
