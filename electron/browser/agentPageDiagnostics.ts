import type { WebContents } from 'electron'
import { withBrowserProtocol, listBrowserDiagnosticEvents, scrubBrowserDiagnosticText } from './agentCdpSession'

export interface BrowserDiagnosticRequest {
  action: 'console' | 'network' | 'performance' | 'evaluate' | 'cdp'
  expression?: string
  method?: string
  parameters?: Record<string, unknown>
  limit?: number
}

export async function readBrowserDiagnostics(
  contents: WebContents,
  _projectPath: string,
  input: BrowserDiagnosticRequest,
) {
  const limit = input.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Diagnostic limit must be an integer between 1 and 100.')
  }
  return withBrowserProtocol(contents, async (send) => {
    if (input.action === 'console' || input.action === 'network') {
      return {
        category: input.action,
        events: listBrowserDiagnosticEvents(contents, input.action, limit),
        note: 'Events are recorded while TideCode is attached; older events may be unavailable.',
      }
    }
    if (input.action === 'performance') {
      await send('Performance.enable')
      const metrics = await send('Performance.getMetrics') as {
        metrics?: Array<{ name: string; value: number }>
      }
      return {
        metrics: (metrics.metrics ?? [])
          .filter((metric) => Number.isFinite(metric.value))
          .slice(0, 80),
      }
    }
    if (input.action === 'evaluate') {
      if (typeof input.expression !== 'string' || !input.expression.trim() || input.expression.length > 10_000) {
        throw new Error('JavaScript expression is required (maximum 10,000 characters).')
      }
      const result = await send('Runtime.evaluate', {
        expression: input.expression, returnByValue: true,
        awaitPromise: true, timeout: 10_000,
      }) as { exceptionDetails?: { text?: string }; result?: { value?: unknown; description?: string } }
      if (result.exceptionDetails) {
        throw new Error(scrubBrowserDiagnosticText(String(result.exceptionDetails.text)))
      }
      const value = JSON.stringify(result.result?.value ?? result.result?.description ?? null)
      return { value: scrubBrowserDiagnosticText((value ?? 'null').slice(0, 8000)) }
    }
    if (input.action === 'cdp') {
      if (typeof input.method !== 'string' || !/^[A-Za-z]+\.[A-Za-z]+$/u.test(input.method)) {
        throw new Error('A valid CDP domain.method is required.')
      }
      if (['Browser.close', 'Target.createTarget', 'Target.attachToTarget', 'Target.setAutoAttach', 'Target.disposeBrowserContext'].includes(input.method)) {
        throw new Error('This browser-wide CDP operation is not available through tab diagnostics.')
      }
      const value = await send(input.method, input.parameters ?? {})
      return { method: input.method, result: scrubBrowserDiagnosticText(JSON.stringify(value).slice(0, 8000)) }
    }
    throw new Error('Unknown diagnostic action.')
  })
}
