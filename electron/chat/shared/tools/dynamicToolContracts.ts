import type { ToolExecutionOptions, ToolSet } from 'ai'

export const DYNAMIC_TOOL_NAMES = ['list_tools', 'get_tool_schema', 'execute_tool'] as const
export const DYNAMIC_TOOL_PAGE_SIZE = 10
export const DYNAMIC_SCHEMA_BATCH_SIZE = 20
export const DYNAMIC_EXECUTE_TOOL_NAME = 'execute_tool'

export type DynamicMetaToolName = (typeof DYNAMIC_TOOL_NAMES)[number]
export type DynamicNativeTool = ToolSet[string]
export type DynamicToolExecutionOptions = ToolExecutionOptions<unknown>
export type DynamicToolExecutor = (
  input: unknown,
  options: DynamicToolExecutionOptions,
) => unknown

export interface DynamicToolSummary {
  description: string
  id: string
  name: string
  tags: string[]
}

export interface DynamicToolGuidance {
  safety: string[]
  whenToUse: string
  workflow: string[]
}

export interface DynamicToolCatalogEntry extends DynamicToolSummary {
  inputSchema: Record<string, unknown>
  nativeTool: DynamicNativeTool
  execute: DynamicToolExecutor | null
  aliases: string[]
  searchHints: string[]
  guidance: DynamicToolGuidance
}

export interface DynamicToolInvocationMetadata {
  argumentsValue: unknown
  toolName: string
}

export interface DynamicListInput {
  page?: number
  query?: string
}

export type DynamicSchemaInput =
  | { id: string; ids?: never }
  | { id?: never; ids: string[] }

export interface DynamicExecuteInput {
  args: Record<string, unknown>
  id: string
}

export interface DynamicToolPage {
  hasMore: boolean
  page: number
  pageSize: number
  query: string | null
  results: DynamicToolSummary[]
  totalMatches: number
  totalPages: number
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDynamicMetaToolName(value: string): value is DynamicMetaToolName {
  return (DYNAMIC_TOOL_NAMES as readonly string[]).includes(value)
}

export function isDynamicToolInvocationMetadata(value: unknown): value is DynamicToolInvocationMetadata {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.toolName === 'string' && value.toolName.trim().length > 0 && 'argumentsValue' in value
}

export function toDynamicToolSummary(entry: DynamicToolCatalogEntry): DynamicToolSummary {
  return {
    description: entry.description,
    id: entry.id,
    name: entry.name,
    tags: [...entry.tags],
  }
}
