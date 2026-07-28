import { jsonSchema, tool } from 'ai'
import type { SkillSummary } from '../../../../src/types/skills'
import {
  buildLoadedSkillResult,
  buildSkillToolDescription,
  loadEnabledSkillByName,
  paginateSkills,
  readSkillResource,
  searchSkills,
} from '../../../skills/service'
import type { WorkspaceToolContext } from './workspaceTools'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

export interface SkillToolInput {
  action: 'list' | 'search' | 'load' | 'read_resource'
  name?: string
  page?: number
  query?: string
  resourcePath?: string
}

export function createSkillTool(context: WorkspaceToolContext, enabledSkills: SkillSummary[]) {
  return tool({
    description: buildSkillToolDescription(),
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        action: {
          description: 'The mode/action to perform: "load" (loads SKILL.md), "list", "search", or "read_resource".',
          enum: ['list', 'search', 'load', 'read_resource'],
          type: 'string',
        },
        name: {
          description: 'The skill name. Required for "load" and "read_resource".',
          type: 'string',
        },
        page: {
          description: 'Page number for "list" mode (1-indexed, max 10 skills per page). Default: 1.',
          type: 'integer',
        },
        query: {
          description: 'Search query keyword for "search" mode.',
          type: 'string',
        },
        resourcePath: {
          description: 'Relative path to resource file inside skill directory for "read_resource" mode (e.g., "references/acting/character-arcs.md").',
          type: 'string',
        },
      },
      required: ['action'],
      type: 'object',
    }),
    execute: async (rawInput) => {
      const input = rawInput as SkillToolInput
      try {
        switch (input.action) {
          case 'list': {
            const page = Math.max(1, input.page ?? 1)
            const pagination = paginateSkills(enabledSkills, page, 10)
            if (pagination.items.length === 0) {
              return {
                body: `No skills found for page ${page}. Total available skills: ${pagination.totalSkills}.`,
                status: 'success',
                summary: 'Listed skills (empty page)',
              }
            }

            const formattedList = pagination.items
              .map((skill, idx) => {
                const globalIndex = (pagination.currentPage - 1) * pagination.pageSize + idx + 1
                return `${globalIndex}. **${skill.name}**\n   ${skill.description}`
              })
              .join('\n\n')

            const footer =
              pagination.currentPage < pagination.totalPages
                ? `Page ${pagination.currentPage} of ${pagination.totalPages} — To view page ${pagination.currentPage + 1}, run \`skill\` with \`action: "list", page: ${pagination.currentPage + 1}\`.`
                : `Page ${pagination.currentPage} of ${pagination.totalPages}`

            return {
              body: [
                '### Skills',
                '',
                formattedList,
                '',
                footer,
              ].join('\n'),
              status: 'success',
              summary: `Listed ${pagination.items.length} skills (Page ${pagination.currentPage}/${pagination.totalPages})`,
            }
          }

          case 'search': {
            const query = input.query?.trim() ?? ''
            if (!query) {
              return createToolErrorResult('Search query parameter "query" is required for search mode.')
            }

            const matches = searchSkills(enabledSkills, query)
            if (matches.length === 0) {
              return {
                body: `No skills matching "${query}" were found.`,
                status: 'success',
                summary: `Searched skills for "${query}" (0 matches)`,
              }
            }

            const formattedMatches = matches
              .slice(0, 10)
              .map((skill, idx) => `${idx + 1}. **${skill.name}**\n   ${skill.description}`)
              .join('\n\n')

            const totalNotice =
              matches.length > 10
                ? `\n\n*(Showing top 10 of ${matches.length} matching skills)*`
                : ''

            return {
              body: [
                `### Search Results for "${query}" (${matches.length} match${matches.length === 1 ? '' : 'es'})`,
                '',
                formattedMatches,
                totalNotice,
              ].join('\n'),
              status: 'success',
              summary: `Searched skills for "${query}" (${matches.length} matches)`,
            }
          }

          case 'load': {
            const name = input.name?.trim() ?? ''
            if (!name) {
              return createToolErrorResult('Skill name parameter "name" is required for load mode.')
            }

            const loadedSkill = await loadEnabledSkillByName(name, context.workspaceRootPath, enabledSkills)
            if (!loadedSkill) {
              return createToolErrorResult(
                `Skill "${name}" is unavailable or disabled.`,
                `Use action: "search" or action: "list" to check available skills.`,
              )
            }
            return buildLoadedSkillResult(loadedSkill)
          }

          case 'read_resource': {
            const name = input.name?.trim() ?? ''
            const resourcePath = input.resourcePath?.trim() ?? ''
            if (!name) {
              return createToolErrorResult('Skill name parameter "name" is required for read_resource mode.')
            }
            if (!resourcePath) {
              return createToolErrorResult('Resource path parameter "resourcePath" is required for read_resource mode.')
            }

            const result = await readSkillResource(name, resourcePath, context.workspaceRootPath, enabledSkills)
            if ('error' in result) {
              return createToolErrorResult(result.error)
            }

            return {
              body: result.content.trim(),
              status: 'success',
              subject: {
                kind: 'file',
                path: result.targetPath,
              },
              summary: `Read resource "${resourcePath}" for skill "${result.skill.name}"`,
            }
          }

          default:
            return createToolErrorResult(`Invalid action "${(input as { action: string }).action}". Supported actions: list, search, load, read_resource.`)
        }
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Error executing skill tool action.'))
      }
    },
  })
}

