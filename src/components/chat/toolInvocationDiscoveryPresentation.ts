import type { ToolInvocationTrace } from '../../types/chat'
import { parseCompleteToolArguments, readFirstText } from './toolInvocationParsing'

/** Titles for first-class native discovery, skills, and connected MCP operations. */
export function getDiscoveryToolVerb(invocation: ToolInvocationTrace): string | null {
  const state = invocation.state
  const labels: Record<string, [string, string, string]> = {
    'available.list': ['Listing', 'Listed', 'Tool list failed'],
    'available.search': ['Searching', 'Searched', 'Tool search failed'],
    'available.get': ['Retrieving', 'Retrieved', 'Tool retrieval failed'],
    'skill.list': ['Listing skills', 'Listed skills', 'Skill list failed'],
    'skill.search': ['Searching skills for', 'Searched skills for', 'Skill search failed for'],
    'skill.load': ['Loading skill', 'Loaded skill', 'Skill load failed'],
  }
  const labelsForTool = labels[invocation.toolName]
  if (labelsForTool) return labelsForTool[state === 'running' ? 0 : state === 'completed' ? 1 : 2]
  if (invocation.toolName.startsWith('mcp.')) {
    return state === 'running' ? 'Running' : state === 'completed' ? 'Ran' : 'Failed'
  }
  return null
}

export function getDiscoveryToolTarget(invocation: ToolInvocationTrace): string | null {
  const args = parseCompleteToolArguments(invocation.argumentsText)
  if (invocation.toolName === 'available.list' || invocation.toolName === 'available.search') {
    if (invocation.state !== 'running' && invocation.state !== 'completed') {
      return null
    }
    const namespace = readFirstText(args?.namespace)?.trim()
    if (!namespace || namespace === 'root') {
      return 'tools'
    }
    return /tools$/iu.test(namespace) ? namespace : `${namespace} tools`
  }
  if (invocation.toolName === 'available.get') {
    const name = readFirstText(args?.name)
    if (!name) return 'tool'
    const shortName = name.startsWith('tools.') ? name.slice(6) : name
    return `${shortName} contract`
  }
  if (invocation.toolName === 'skill.search') {
    return readFirstText(args?.query)
  }
  if (invocation.toolName === 'skill.load') return readFirstText(args?.name)
  if (invocation.toolName.startsWith('mcp.')) return `MCP ${invocation.toolName.slice('mcp.'.length).replace(/_/gu, ' ')}`
  return null
}

/** JSON is formatted for the viewer only; model-facing bytes are untouched. */
export function formatDiscoveryToolBody(toolName: string, body: string): string {
  if (!toolName.startsWith('available.') && !toolName.startsWith('mcp.') && !toolName.startsWith('skill.')) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
