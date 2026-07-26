import fs from 'node:fs'
import path from 'node:path'
import { buildChatSystemPrompt } from '../electron/chat/shared/messages'
import { createAgentTools } from '../electron/chat/shared/tools/factory'
import { describeTools, stableStringify } from '../electron/chat/cache/canonicalization'
import { approximateTokenCount } from '../src/lib/contextUsage'
import type { ToolSet } from 'ai'

function sortToolSet(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
  ) as ToolSet
}

async function run() {
  const workspaceRootPath = process.cwd()
  const chatMode = 'agent'
  const terminalExecutionMode = 'sandbox'

  // 1. Build System Prompt
  const systemPrompt = buildChatSystemPrompt(chatMode, workspaceRootPath, {
    terminalExecutionMode,
  })
  const systemPromptChars = systemPrompt.length
  const systemPromptTokens = approximateTokenCount(systemPrompt)

  // 2. Build Agent Tools
  const mockWebContents = { send: () => {} } as any
  const tools = await createAgentTools(
    {
      checkpointId: null,
      conversationId: 'test-dump-session',
      workspaceRootPath,
      terminalExecutionMode,
      webContents: mockWebContents,
    },
    {
      chatMode,
      enabledSkills: [],
      providerId: 'openai',
    },
  )

  const sortedTools = sortToolSet(tools)
  const describedTools = describeTools(sortedTools)
  const fullToolSchemaJson = JSON.stringify(describedTools, null, 2)
  const fullToolSchemaStableStr = stableStringify(describedTools)
  const totalToolSchemaTokens = approximateTokenCount(fullToolSchemaStableStr)

  // 3. Calculate Per-Tool Breakdown
  const toolBreakdown: { name: string; chars: number; tokens: number; schemaJson: string }[] = []
  for (const [name, tool] of Object.entries(sortedTools)) {
    const singleToolDescription = describeTools({ [name]: tool })
    const singleToolJson = JSON.stringify(singleToolDescription, null, 2)
    const singleToolStable = stableStringify(singleToolDescription)
    const tokens = approximateTokenCount(singleToolStable)
    toolBreakdown.push({
      name,
      chars: singleToolStable.length,
      tokens,
      schemaJson: singleToolJson,
    })
  }

  const grandTotalTokens = systemPromptTokens + totalToolSchemaTokens

  // 4. Generate Markdown Dump Output
  let mdContent = `# Echosphere System + Tools Context Dump

**Workspace Root**: \`${workspaceRootPath}\`  
**Chat Mode**: \`${chatMode}\`  
**Terminal Execution Mode**: \`${terminalExecutionMode}\`  

---

## 📊 Token Summary Breakdown

| Component | Character Count | Estimated Tokens (chars / 4) | % of Total |
| :--- | :--- | :--- | :--- |
| **System Prompt** | ${systemPromptChars.toLocaleString()} | **${systemPromptTokens.toLocaleString()} tokens** | ${((systemPromptTokens / grandTotalTokens) * 100).toFixed(1)}% |
| **Tool Schemas (All Tools)** | ${fullToolSchemaStableStr.length.toLocaleString()} | **${totalToolSchemaTokens.toLocaleString()} tokens** | ${((totalToolSchemaTokens / grandTotalTokens) * 100).toFixed(1)}% |
| **TOTAL (System + Tools)** | **${(systemPromptChars + fullToolSchemaStableStr.length).toLocaleString()}** | **${grandTotalTokens.toLocaleString()} tokens** | **100%** |

---

## 🛠️ Per-Tool Token Breakdown

| Tool Name | Schema Chars | Estimated Tokens |
| :--- | :--- | :--- |
${toolBreakdown.map((t) => `| \`${t.name}\` | ${t.chars.toLocaleString()} | **${t.tokens.toLocaleString()} tokens** |`).join('\n')}

---

## 📜 1. Raw System Prompt Text (${systemPromptTokens} tokens)

\`\`\`markdown
${systemPrompt}
\`\`\`

---

## 🔧 2. Raw Serialized Tool Schemas JSON (${totalToolSchemaTokens} tokens)

\`\`\`json
${fullToolSchemaJson}
\`\`\`
`

  const outputPath = path.join(workspaceRootPath, 'dumped_prompt_and_tools.md')
  fs.writeFileSync(outputPath, mdContent, 'utf8')

  console.log(`Successfully dumped prompt & tool context to: ${outputPath}`)
  console.log(`System Prompt Tokens: ${systemPromptTokens}`)
  console.log(`Tool Schemas Tokens:  ${totalToolSchemaTokens}`)
  console.log(`Total System+Tools:   ${grandTotalTokens}`)
}

run().catch((err) => {
  console.error('Failed to dump prompt & tools context:', err)
  process.exit(1)
})
