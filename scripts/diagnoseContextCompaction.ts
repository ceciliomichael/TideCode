import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { ModelMessage } from 'ai'
import { decodeReplayValue } from '../electron/chat/history/replayCodec'
import { parseCanonicalHistoryDocument } from '../electron/chat/history/validation'
import { estimateModelMessageContextUsage } from '../src/lib/contextUsage'
import { calculateModelMessagesContextState } from '../electron/chat/shared/compaction/budget'
import { selectCompactionWindowResult } from '../electron/chat/shared/compaction/window'
import { classifyCacheStep } from '../electron/chat/cache/diagnostics'
import { shouldCompactContext, requiresContextCompaction } from '../electron/chat/shared/compaction/budget'

function scenarioReport() {
  const scenarios: Array<{ name: string; messages: ModelMessage[] }> = [
    { name: 'small_text', messages: [{ role: 'user', content: 'Continue.' }] },
    { name: 'preferred_threshold', messages: [{ role: 'user', content: 'Continue.' }, { role: 'assistant', content: 'E'.repeat(840_000) }] },
    { name: 'admission_limit', messages: [{ role: 'user', content: 'Continue.' }, { role: 'assistant', content: 'E'.repeat(920_000) }] },
    { name: 'temporary_image', messages: [{ role: 'user', content: [
      { type: 'text', text: '[TideCode visual tool result] Screenshot' },
      { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'A'.repeat(4_000_000) } },
    ] }] },
  ]
  return scenarios.map((scenario) => {
    const start = performance.now()
    const state = calculateModelMessagesContextState({
      messages: scenario.messages, systemPromptTokens: 0, toolSchemaTokens: 0,
      contextWindowTokens: 256_000, triggerRatio: 0.8,
    })
    return {
      scenario: scenario.name, estimatedInputTokens: state.budget.totalTokens,
      imageTokens: state.usage.imageTokens,
      preferred: shouldCompactContext(state.budget), required: requiresContextCompaction(state.budget),
      localAccountingMs: performance.now() - start,
    }
  })
}

/** Read-only diagnosis. Supply an isolated copy, never an implicit application history path. */
async function main() {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const index = args.indexOf(name)
    return index < 0 ? undefined : args[index + 1]
  }
  const sourcePath = option('--canonical')
  if (args.includes('--scenarios')) {
    process.stdout.write(`${JSON.stringify({ scenarios: scenarioReport(), note: 'Deterministic accounting decisions; no provider or compaction worker calls.' }, null, 2)}\n`)
    return
  }
  if (!sourcePath) {
    throw new Error('Usage: node --import tsx scripts/diagnoseContextCompaction.ts --scenarios OR --canonical <copied canonical JSON> [--run <id>] [--context <tokens>] [--output <report.json>]')
  }
  const raw = JSON.parse(await readFile(sourcePath, 'utf8')) as { conversationId: string }
  const document = parseCanonicalHistoryDocument(JSON.stringify(raw), raw.conversationId)
  const runId = option('--run') ?? document.events.findLast((event) => event.type === 'run_failed')?.runId
  const start = document.events.find((event) => event.type === 'run_started' && event.runId === runId)
  if (!start || start.type !== 'run_started') {
    throw new Error('The requested run has no saved initial context.')
  }
  let messages = decodeReplayValue(start.initialMessages) as ModelMessage[]
  const snapshots: Array<Record<string, unknown>> = []
  const durations: number[] = []
  const capacity = Number(option('--context') ?? 256_000)
  for (const event of document.events) {
    if (event.runId !== runId || event.type !== 'step_completed') continue
    messages = [...messages, ...decodeReplayValue(event.responseMessages) as ModelMessage[]]
    const began = performance.now()
    const state = calculateModelMessagesContextState({
      messages, contextWindowTokens: capacity,
      systemPromptTokens: 0, toolSchemaTokens: document.promptContext?.toolSchemaTokens ?? 0,
      triggerRatio: 0.8,
    })
    const selection = selectCompactionWindowResult(messages, 10_000, { retainedContextTokens: 10_000 })
    durations.push(performance.now() - began)
    snapshots.push({
      step: event.stepNumber, estimatedInputWithoutSystem: state.budget.totalTokens,
      providerReportedInput: event.usage.inputTokens, cache: classifyCacheStep(event.usage),
      savedAccounting: event.contextUsage ?? null,
      admissionTokens: state.budget.admissionTokens,
      selection: selection.reason ?? 'available',
      sourceMessages: selection.window?.evictedMessages.length ?? 0,
    })
  }
  durations.sort((left, right) => left - right)
  const quantile = (fraction: number) => durations[Math.max(0, Math.ceil(durations.length * fraction) - 1)] ?? 0
  const attempts = document.events.filter((event) => event.runId === runId && event.type === 'compaction_attempted')
  const report = {
    runId, branchId: start.branchId, reconstructedMessages: messages.length,
    limitations: [
      'Temporary visuals are not saved; their historical presence cannot be reconstructed.',
      'Historical system prompt and compaction settings are not fully captured; supplied capacity is a scenario input.',
      'SDK message replacements during the run are not reconstructable from step responses alone; this is not proof of the exact failed live request.',
    ],
    currentEstimate: estimateModelMessageContextUsage(messages),
    snapshots, attempts,
    localAccountingAndSelectionMs: { median: quantile(0.5), p95: quantile(0.95) },
  }
  const text = `${JSON.stringify(report, null, 2)}\n`
  const output = option('--output')
  if (output) {
    if (resolve(output) === resolve(sourcePath)) {
      throw new Error('Output must not overwrite the source history.')
    }
    await writeFile(output, text, { flag: 'wx' })
  } else {
    process.stdout.write(text)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Diagnosis failed.'}\n`)
  process.exitCode = 1
})
