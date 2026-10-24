import type { GenerationMetrics } from '../../../src/types/chat'

function reportedOutputTokens(usage: unknown): number | undefined {
  if (typeof usage !== 'object' || usage === null || !('outputTokens' in usage)) {
    return undefined
  }
  const tokens = usage.outputTokens
  if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0) {
    return tokens
  }
  return undefined
}

/** Measures observed output intervals, excluding waits before output and between model requests. */
export class StreamGenerationMetrics {
  private outputTokens = 0
  private estimated = false
  private stepCharacters = 0
  private generationMs = 0
  private firstDeltaAt: number | null = null
  private lastDeltaAt: number | null = null
  private toolExecutionMs = 0
  private toolsStartedAt: number | null = null
  private readonly executingTools = new Set<string>()
  private readonly streamedArguments = new Set<string>()
  private requestBaseTokens = 0
  private requestBaseEstimated = false

  constructor(private readonly now: () => number = () => performance.now()) {}

  beginRequest() {
    this.requestBaseTokens = this.outputTokens
    this.requestBaseEstimated = this.estimated
    this.streamedArguments.clear()
  }

  private addDelta(text: string) {
    if (text.length === 0) {
      return
    }
    const now = this.now()
    this.firstDeltaAt ??= now
    this.lastDeltaAt = now
    this.stepCharacters += text.length
  }

  private closeGeneration() {
    if (this.firstDeltaAt !== null && this.lastDeltaAt !== null) {
      this.generationMs += this.lastDeltaAt - this.firstDeltaAt
    }
    this.firstDeltaAt = null
    this.lastDeltaAt = null
  }

  private finishStep(usage?: unknown) {
    this.closeGeneration()
    const reported = reportedOutputTokens(usage)
    this.outputTokens += reported ?? Math.ceil(this.stepCharacters / 4)
    this.estimated ||= reported === undefined && this.stepCharacters > 0
    this.stepCharacters = 0
  }

  observe(part: { type: string; [key: string]: unknown }) {
    if ((part.type === 'text-delta' || part.type === 'reasoning-delta') && typeof part.text === 'string') {
      this.addDelta(part.text)
    }
    if (part.type === 'tool-input-delta' && typeof part.delta === 'string' && typeof part.id === 'string') {
      this.streamedArguments.add(part.id)
      this.addDelta(part.delta)
    }
    if (part.type === 'tool-call' && typeof part.toolCallId === 'string') {
      if (!this.streamedArguments.has(part.toolCallId)) {
        // Some providers deliver complete arguments without streaming them.
        this.addDelta(JSON.stringify(part.input ?? part.args ?? {}))
      }
      this.closeGeneration()
      this.toolsStartedAt ??= this.now()
      this.executingTools.add(part.toolCallId)
    }
    if ((part.type === 'tool-result' || part.type === 'tool-error' || part.type === 'tool-output-denied') && typeof part.toolCallId === 'string') {
      this.executingTools.delete(part.toolCallId)
      if (this.executingTools.size === 0 && this.toolsStartedAt !== null) {
        this.toolExecutionMs += this.now() - this.toolsStartedAt
        this.toolsStartedAt = null
      }
    }
    if (part.type === 'finish-step') {
      this.finishStep(part.usage)
    }
    if (part.type === 'finish') {
      this.finishStep()
      const total = reportedOutputTokens(part.totalUsage)
      if (total !== undefined) {
        this.outputTokens = this.requestBaseTokens + total
        this.estimated = this.requestBaseEstimated
      }
    }
  }

  endRequest() {
    this.finishStep()
    if (this.toolsStartedAt !== null) {
      this.toolExecutionMs += this.now() - this.toolsStartedAt
      this.toolsStartedAt = null
    }
    this.executingTools.clear()
  }

  snapshot(): GenerationMetrics {
    let generationMs = this.generationMs
    if (this.firstDeltaAt !== null && this.lastDeltaAt !== null) {
      generationMs += this.lastDeltaAt - this.firstDeltaAt
    }
    let toolExecutionMs = this.toolExecutionMs
    if (this.toolsStartedAt !== null) {
      toolExecutionMs += this.now() - this.toolsStartedAt
    }
    return {
      outputTokens: this.outputTokens + Math.ceil(this.stepCharacters / 4),
      estimated: this.estimated || this.stepCharacters > 0,
      generationMs,
      toolExecutionMs,
    }
  }
}
