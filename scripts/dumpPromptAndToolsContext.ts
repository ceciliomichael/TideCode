import fs from 'node:fs'
import path from 'node:path'
import { buildChatModeSystemPromptBreakdown } from '../electron/chat/shared/prompts/mode'
import { buildChatSystemPrompt } from '../electron/chat/shared/messages'
import { createAgentTools } from '../electron/chat/shared/tools/factory'
import { describeTools, stableStringify } from '../electron/chat/cache/canonicalization'
import { listEnabledSkills } from '../electron/skills/service'
import { approximateTokenCount } from '../src/lib/contextUsage'
import type { ToolSet } from 'ai'

const DEFAULT_OUTPUT_FILE = 'prompt_context_audit.json'

interface AuditComponent {
  chars: number
  content: string | null
  id: string
  section: string
  source: string
  tokens: number
}

interface ToolAuditEntry {
  chars: number
  name: string
  schema: unknown
  tokens: number
}

function sortToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
  ) as ToolSet
}

function parseOutputPath(workspaceRootPath: string) {
  const outputArgument = process.argv
    .slice(2)
    .find((argument) => argument.startsWith('--output='))
    ?.slice('--output='.length)
    .trim()

  return path.resolve(workspaceRootPath, outputArgument || DEFAULT_OUTPUT_FILE)
}

function buildComponentAudit(
  components: ReturnType<typeof buildChatModeSystemPromptBreakdown>['components'],
): AuditComponent[] {
  return components.map((component) => ({
    chars: component.content.length,
    content: component.id === 'workspace_instructions' ? null : component.content,
    id: component.id,
    section: component.section,
    source: component.source,
    tokens: approximateTokenCount(component.content),
  }))
}

function buildToolAudit(tools: ToolSet): ToolAuditEntry[] {
  return Object.entries(tools).map(([name, tool]) => {
    const schema = describeTools({ [name]: tool })
    const stableSchema = stableStringify(schema)
    return {
      chars: stableSchema.length,
      name,
      schema,
      tokens: approximateTokenCount(stableSchema),
    }
  })
}

function countOccurrences(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0
}

async function run() {
  const workspaceRootPath = process.cwd()
  const chatMode = 'agent' as const
  const providerId = 'openai' as const
  const terminalExecutionMode = 'sandbox' as const
  const outputPath = parseOutputPath(workspaceRootPath)

  const promptBreakdown = buildChatModeSystemPromptBreakdown(chatMode, workspaceRootPath, {
    terminalExecutionMode,
  })
  const systemPrompt = buildChatSystemPrompt(chatMode, workspaceRootPath, {
    terminalExecutionMode,
  })
  if (systemPrompt !== promptBreakdown.systemPrompt) {
    throw new Error('Prompt audit breakdown does not match the runtime system prompt.')
  }
  const systemComponents = buildComponentAudit(promptBreakdown.components)
  const componentChars = systemComponents.reduce((total, component) => total + component.chars, 0)
  const assemblyOverheadChars = Math.max(0, systemPrompt.length - componentChars)
  const workspaceInstructionsComponent = promptBreakdown.components.find(
    (component) => component.id === 'workspace_instructions',
  )
  const redactedSystemPrompt = workspaceInstructionsComponent
    ? systemPrompt.replace(
        workspaceInstructionsComponent.content,
        '[workspace instructions omitted from audit dump]',
      )
    : systemPrompt

  const enabledSkills = await listEnabledSkills(workspaceRootPath)
  const mockWebContents = { send: () => undefined } as unknown as WebContents
  const tools = await createAgentTools(
    {
      checkpointId: null,
      conversationId: 'prompt-context-audit',
      terminalExecutionMode,
      webContents: mockWebContents,
      workspaceRootPath,
    },
    {
      chatMode,
      enabledSkills,
      providerId,
    },
  )

  const sortedTools = sortToolSet(tools)
  const describedTools = describeTools(sortedTools)
  const stableToolSchema = stableStringify(describedTools)
  const toolAudit = buildToolAudit(sortedTools)
  const toolSchemaChars = stableToolSchema.length
  const toolSchemaTokens = approximateTokenCount(stableToolSchema)
  const totalChars = systemPrompt.length + toolSchemaChars
  const totalTokens = approximateTokenCount(systemPrompt) + toolSchemaTokens

  const report = {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/dumpPromptAndToolsContext.ts',
    configuration: {
      chatMode,
      providerId,
      terminalExecutionMode,
      workspaceRootPath,
    },
    totals: {
      chars: totalChars,
      estimatedTokens: totalTokens,
      systemPromptChars: systemPrompt.length,
      systemPromptTokens: approximateTokenCount(systemPrompt),
      toolSchemaChars,
      toolSchemaTokens,
    },
    systemPrompt: {
      chars: systemPrompt.length,
      estimatedTokens: approximateTokenCount(systemPrompt),
      assemblyOverhead: {
        chars: assemblyOverheadChars,
        estimatedTokens: approximateTokenCount('x'.repeat(assemblyOverheadChars)),
        note: 'Wrapper tags and separators added by the prompt assembler, not by a source component.',
      },
      components: [
        ...systemComponents,
        {
          chars: assemblyOverheadChars,
          content: null,
          id: 'prompt_assembly_overhead',
          section: 'assembly',
          source: 'electron/chat/shared/prompts/mode/index.ts',
          tokens: approximateTokenCount('x'.repeat(assemblyOverheadChars)),
        },
      ].sort((left, right) => right.tokens - left.tokens),
      skillVisibility: {
        availableSkillsBlockPresent: /<available_skills>/u.test(systemPrompt),
        enabledSkillCount: enabledSkills.length,
        enabledSkillNames: enabledSkills.map((skill) => skill.name),
        genericSkillTermOccurrences: countOccurrences(systemPrompt, /skill/giu),
      },
      raw: redactedSystemPrompt,
    },
    providerTools: {
      count: Object.keys(sortedTools).length,
      names: Object.keys(sortedTools),
      chars: toolSchemaChars,
      estimatedTokens: toolSchemaTokens,
      entries: toolAudit.sort((left, right) => right.tokens - left.tokens),
      raw: describedTools,
      stableSerialized: stableToolSchema,
    },
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  const largestSystemComponents = systemComponents
    .slice()
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 5)

  console.log(`Prompt context audit written to: ${outputPath}`)
  console.log(`System prompt: ${report.totals.systemPromptTokens} estimated tokens (${report.totals.systemPromptChars} chars)`)
  console.log(`Provider tool schemas: ${report.totals.toolSchemaTokens} estimated tokens (${report.totals.toolSchemaChars} chars)`)
  console.log(`Combined context: ${report.totals.estimatedTokens} estimated tokens (${report.totals.chars} chars)`)
  console.log(`Provider-facing tools: ${report.providerTools.names.join(', ')}`)
  console.log(`Skills in system prompt: ${report.systemPrompt.skillVisibility.genericSkillTermOccurrences > 0 ? 'detected' : 'none detected'}`)
  console.log('Largest system-prompt source components:')
  for (const component of largestSystemComponents) {
    console.log(`  ${component.tokens} tokens - ${component.id} (${component.source})`)
  }
}

run().catch((error) => {
  console.error('Failed to audit prompt and tool context:', error)
  process.exit(1)
})
