import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getTideCodeRuntimeRoot } from '../../../../runtime/runtimeRoot'
import type { ToolSet } from 'ai'

const AI_ROOT = 'electron/chat/shared/ai'
const API_NAMES = new Set([
  'read', 'list', 'glob', 'grep',
  'terminal.execute', 'terminal.read', 'terminal.interact', 'terminal.terminate',
  'skill.list', 'skill.search', 'skill.load', 'plan.create',
  'edit', 'patch', 'write', 'available.list', 'available.search', 'available.get',
])

function readRequiredMarkdown(relativePath: string): string {
  const absolutePath = path.join(getTideCodeRuntimeRoot(), AI_ROOT, relativePath)
  const content = readFileSync(absolutePath, 'utf8').trim()
  if (content.length === 0) throw new Error(`Empty required AI instructions: ${absolutePath}`)
  return content
}

export function getExecInstructions(): string {
  return readRequiredMarkdown('exec/exec.md')
}

export function getWorkerInstructions(name: 'git-commit' | 'git-pull-request'): string {
  return readRequiredMarkdown(`prompts/workers/${name}.md`)
}

export function getApiInstructions(apiPath: string): string {
  if (!API_NAMES.has(apiPath)) throw new Error(`Unknown TideCode API documentation: ${apiPath}`)
  const segments = apiPath.split('.')
  const leaf = segments.at(-1)!
  return readRequiredMarkdown(path.posix.join('tools', ...segments, `${leaf}.md`))
}

export function documentNativeApi(name: string, api: ToolSet[string]): ToolSet[string] {
  api.description = getApiInstructions(name)
  return api
}
