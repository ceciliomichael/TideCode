import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import { validateBrowserSequence, type AgentBrowserStep, type BrowserSequenceCapture } from '../../../browser/agentPageSequence'
import { validateBrowserInteraction, type AgentBrowserInteraction, type BrowserActionReport } from '../../../browser/agentPageInput'
import { validateBrowserNavigation, type BrowserNavigationInput } from '../../../browser/agentPageNavigation'
import type { JSONSchema7 } from '@ai-sdk/provider'
import { storeChatImageAttachment } from '../../../history/chatAttachments'
import { requestTideCodeBrowser } from '../../../runService/browserService'
import { resolveAgentViewport } from '../../../browser/agentViewport'
import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const STRING = { type: 'string' } as const
const TAB_ID = { type: 'string', minLength: 1 } as const
const ACTIONS = ['click', 'hover', 'double_click', 'drag', 'fill', 'type', 'key', 'scroll'] as const

const INTERACTION_PROPERTIES: Record<string, JSONSchema7> = {
  action: { type: 'string', enum: [...ACTIONS] },
  element_ref: { ...STRING, description: 'Target from browser.read; required for fill, optional for pointer actions when coordinates are supplied.' },
  observation_id: { ...STRING, description: 'Required with coordinate pointer actions. Use the latest observation_id from browser.read.' },
  x: { type: 'number', description: 'Viewport CSS pixel X for pointer actions or scrolling.' },
  y: { type: 'number', description: 'Viewport CSS pixel Y for pointer actions or scrolling.' },
  to_x: { type: 'number', description: 'Destination X in viewport CSS pixels for drag.' },
  to_y: { type: 'number', description: 'Destination Y in viewport CSS pixels for drag.' },
  button: { type: 'string', enum: ['left', 'right', 'middle'] },
  text: STRING,
  key: STRING,
  delta_x: { type: 'number' },
  delta_y: { type: 'number' },
}

interface BrowserToolInput {
  url: string
  steps?: AgentBrowserStep[]
  new_tab?: boolean
  tab_id: string
  action: string
  element_ref?: string
  observation_id?: string
  text?: string
  key?: string
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  button?: 'left' | 'right' | 'middle'
  delta_x?: number
  delta_y?: number
  view?: 'visual' | 'structure' | 'combined' | 'annotations'
  width?: number
  height?: number
  include_annotations?: boolean
  offset?: number
  limit?: number
  page?: number
  expression?: string
  wait_until?: 'none' | 'commit' | 'domcontentloaded' | 'load'
  timeout_ms?: number
  method?: string
  parameters?: Record<string, unknown>
}

function makeTool(
  properties: Record<string, JSONSchema7>,
  required: string[],
  execute: (input: BrowserToolInput, signal?: AbortSignal) => Promise<AgentToolExecutionResult>,
  constraints: Pick<JSONSchema7, 'oneOf'> = {},
  description = 'TideCode native browser automation.',
) {
  return tool({
    description,
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties, required, ...constraints }),
    execute: async (input, options) => {
      try {
        return await execute(input as BrowserToolInput, options?.abortSignal)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Browser operation failed.'))
      }
    },
  })
}

function plainTabList(input: { page: number; total: number; has_more: boolean; tabs: Array<{ tab_id: string; kind: string; title: string; url: string }> }) {
  const rows = input.tabs.map((tab, index) => [
    `${(input.page - 1) * 10 + index + 1}. ${tab.title.replace(/[\r\n]/gu, ' ').slice(0, 100)}`,
    `   Ownership: ${tab.kind === 'agent' ? 'AI-owned' : 'User-owned'}`,
    `   Tab: ${tab.tab_id}`,
    `   URL: ${tab.url.replace(/[\r\n]/gu, ' ').slice(0, 1000)}`,
  ].join('\n'))
  return [`Browser tabs: page ${input.page}, ${input.total} total`, ...rows,
    input.has_more ? `More tabs: page ${input.page + 1}` : 'No more tabs.'].join('\n\n')
}


function diagnosticCell(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.length + ' items'
    return Object.keys(value).length + ' fields'
  }
  return String(value).replace(/[|<>\r\n`]/gu, ' ').slice(0, 4000)
}

function formatBrowserDiagnostics(output: unknown): string {
  if (!output || typeof output !== 'object') return diagnosticCell(output)
  const record = output as Record<string, unknown>
  if (Array.isArray(record.events)) {
    return record.events.length ? record.events.slice(0, 100).map((event) => {
      const item = event as Record<string, unknown>
      const time = typeof item.time === 'number' ? new Date(item.time).toISOString() : 'Unknown time'
      return `${time}  ${diagnosticCell(item.category)} / ${diagnosticCell(item.level)}: ${diagnosticCell(item.message)}`
    }).join('\n') : 'No events recorded.'
  }
  if (Array.isArray(record.metrics)) {
    return record.metrics.slice(0, 80).map((metric) => {
      const item = metric as Record<string, unknown>
      return `${diagnosticCell(item.name)}: ${diagnosticCell(item.value)}`
    }).join('\n')
  }
  return Object.entries(record).slice(0, 50).map(([name, value]) => `${name}: ${diagnosticCell(value)}`).join('\n')
}


function sequenceRows(steps: AgentBrowserStep[], data: Record<string, unknown>): string[] {
  const reports = Array.isArray(data.actions) ? data.actions as Array<{ step: number; report: BrowserActionReport }> : []
  const completed = typeof data.completed_steps === 'number' ? data.completed_steps : 0
  const failed = typeof data.failed_step === 'number' ? data.failed_step : -1
  return steps.map((step, index) => {
    const number = index + 1
    const report = reports.find((item) => item.step === number)?.report
    const reference = 'element_ref' in step ? step.element_ref : undefined
    const target = report?.target ?? (typeof reference === 'string' ? reference : step.action)
    const x = report?.x ?? ('x' in step ? step.x : undefined)
    const y = report?.y ?? ('y' in step ? step.y : undefined)
    const toX = report?.to_x ?? ('to_x' in step ? step.to_x : undefined)
    const toY = report?.to_y ?? ('to_y' in step ? step.to_y : undefined)
    const method = report?.method ?? (reference ? 'element_ref' : x !== undefined ? 'coordinates' : 'other')
    const coords = x === undefined ? 'N/A' : `${report ? '' : 'requested ' }(${Math.round(x)}, ${Math.round(y ?? 0)})${toX === undefined ? '' : ` to (${Math.round(toX)}, ${Math.round(toY ?? 0)})`}`
    const status = number === failed ? 'Failed' : number > completed ? 'Not executed' : step.action === 'read' ? 'Observed' : step.action.startsWith('wait') ? 'Wait completed' : 'Input dispatched'
    const detail = report?.detail ?? ('text' in step && typeof step.text === 'string' ? `${step.text.length} characters` : '')
    return `${number}. ${step.action}: ${diagnosticCell(target)}\n   Coordinates: ${coords} | Method: ${method} | ${status}${detail ? ` | ${detail}` : ''}`
  })
}


export function createBrowserToolSet(context: AgentToolContext): Record<string, ToolSet[string]> {
  const workspace = context.workspaceRootPath
  return {
    'browser.navigate': makeTool({
      tab_id: TAB_ID,
      action: { type: 'string', enum: ['goto', 'back', 'forward', 'reload', 'stop'] },
      url: STRING,
      wait_until: { type: 'string', enum: ['none', 'commit', 'domcontentloaded', 'load'] },
      timeout_ms: { type: 'integer', minimum: 100, maximum: 20000 },
    }, ['tab_id', 'action'], async ({ tab_id, action, url, wait_until, timeout_ms }, signal) => {
      const input = { action, url, wait_until, timeout_ms } as BrowserNavigationInput
      validateBrowserNavigation(input)
      const { data } = await requestTideCodeBrowser({
        operation: 'navigate', projectPath: workspace, tabId: tab_id, input,
      }, signal)
      return {
        status: 'success',
        summary: 'Browser navigation: ' + action,
        body: [
          'Browser navigation',
          'Tab: ' + tab_id,
          'Action: ' + action,
          'From: ' + data.from,
          'URL: ' + data.url,
          'Status: ' + data.status,
          'Loading: ' + (data.loading ? 'Yes' : 'No'),
          ...(data.title ? ['Title: ' + data.title] : []),
        ].join('\n'),
        semantics: { tab_id, ...data },
      }
    }, {}, 'Navigate an existing AI-owned tab. Supports goto, back, forward, reload and stop with bounded page-load waiting.'),
    'browser.open': makeTool({
      url: { ...STRING, minLength: 1 },
      new_tab: { type: 'boolean' },
      width: { type: 'integer', minimum: 1, maximum: 4096 },
      height: { type: 'integer', minimum: 1, maximum: 4096 },
    }, ['url'], async ({ url, new_tab = false, width, height }, signal) => {
      const { data } = await requestTideCodeBrowser({
        operation: 'open', projectPath: workspace, url, newTab: new_tab, width, height,
      }, signal)
      return {
        status: 'success',
        summary: data.status === 'reused' ? 'Reused browser tab' : 'Opened browser tab',
        body: [
          'AI-owned browser tab',
          'Tab: ' + diagnosticCell(data.tab_id),
          'URL: ' + diagnosticCell(data.url),
          'Title: ' + diagnosticCell(data.title || 'Untitled'),
          'Status: ' + diagnosticCell(data.status),
          'Viewport: ' + data.width + ' × ' + data.height,
          ...(data.error ? ['Load error: ' + data.error] : []),
        ].join('\n'),
        semantics: { tab_id: data.tab_id, url: data.url, status: data.status, width: data.width, height: data.height },
      }
    }, {}, 'Open an isolated AI-owned Chromium tab at optional width and height (default 1440 × 900), without resizing the user browser.'),
    'browser.tabs': makeTool({ page: { type: 'integer', minimum: 1 } }, [], async ({ page = 1 }, signal) => {
      const { data } = await requestTideCodeBrowser({ operation: 'tabs', projectPath: workspace, page }, signal)
      const result = data as {
        page: number
        total: number
        has_more: boolean
        tabs: Array<{ tab_id: string; kind: string; title: string; url: string }>
      }
      return {
        status: 'success',
        summary: 'Listed browser tabs',
        body: plainTabList(result),
        semantics: { page: result.page, total: result.total, has_more: result.has_more },
      }
    }, {}, 'List project tabs marked AI-owned or User-owned. User-owned tabs are read-only to AI; only AI-owned tabs permit interaction, diagnostics and closure.'),
    'browser.terminate': makeTool({ tab_id: TAB_ID }, ['tab_id'], async ({ tab_id }, signal) => {
      const { data } = await requestTideCodeBrowser({ operation: 'terminate', projectPath: workspace, tabId: tab_id }, signal)
      return {
        status: 'success',
        summary: data.status === 'closed' ? 'Closed browser tab' : 'Requested browser tab close',
        body: 'AI-owned tab closed\nTab: ' + tab_id + '\nStatus: ' + data.status,
      }
    }, {}, 'Close an AI-owned page only. User-owned tabs cannot be closed by AI.'),
    'browser.interact': makeTool({
      tab_id: TAB_ID,
      ...INTERACTION_PROPERTIES,
      steps: {
        type: 'array', minItems: 1, maxItems: 32,
        description: 'Execute input, wait, and read steps locally in order, using one viewport. Use instead of action.',
        items: {
          type: 'object', additionalProperties: false, required: ['action'],
          properties: {
            ...INTERACTION_PROPERTIES,
            action: { type: 'string', enum: [...ACTIONS, 'wait', 'wait_for', 'read'] },
            label: { type: 'string', maxLength: 120 },
            duration_ms: { type: 'integer', minimum: 0, maximum: 5000 },
            selector: { type: 'string', maxLength: 512 },
            url_contains: { type: 'string', maxLength: 512 },
            timeout_ms: { type: 'integer', minimum: 0, maximum: 5000 },
            view: { type: 'string', enum: ['combined', 'visual', 'structure'] },
            offset: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    }, ['tab_id'], async ({ tab_id, steps, ...action }, signal) => {
      if (steps !== undefined) {
        if (Object.keys(action).length) {
          throw new Error('Pass steps or a single action, without mixing them.')
        }
        validateBrowserSequence(steps)
        const { data, captures = [] } = await requestTideCodeBrowser({
          operation: 'sequence', projectPath: workspace, tabId: tab_id, steps,
        }, signal)
        const body = [
          'Browser sequence',
          'Tab: ' + tab_id,
          'Completed: ' + data.completed_steps + '/' + steps.length,
          'Elapsed: ' + data.elapsed_ms + 'ms',
          '',
          ...sequenceRows(steps, data),
          ...(data.error ? ['', 'Stopped at step ' + data.failed_step + ': ' + data.error,
            'Earlier actions were not rolled back. No actions were retried.'] : []),
          ...captures.map((capture) => '\n' + capture.label + ' (step ' + capture.step + ', '
            + capture.started_ms + '–' + capture.completed_ms + 'ms)\n' + capture.body),
        ].join('\n')
        const presented = await presentSequenceCaptures(context, tab_id, captures, body)
        return {
          status: data.error ? 'error' : 'success',
          summary: data.error ? 'Browser sequence stopped at step ' + data.failed_step : 'Executed browser sequence',
          ...presented,
          semantics: { tab_id, ...data },
        }
      }
      validateBrowserInteraction(action as AgentBrowserInteraction)
      const { data } = await requestTideCodeBrowser({
        operation: 'interact', projectPath: workspace, tabId: tab_id, action,
      }, signal)
      return {
        status: 'success',
        summary: 'Browser ' + data.action,
        body: [
          'Browser ' + data.action,
          'Tab: ' + diagnosticCell(tab_id),
          'URL: ' + diagnosticCell(data.url),
          ...((data.report && typeof data.report === 'object') ? [
            'Target: ' + diagnosticCell((data.report as { target?: string }).target ?? 'Page'),
            'Method: ' + diagnosticCell((data.report as { method?: string }).method ?? 'Unknown'),
            'Coordinates: ' + ((data.report as { x?: number; y?: number }).x === undefined
              ? 'N/A' : '(' + (data.report as { x: number }).x + ', ' + (data.report as { y: number }).y + ')'),
            ...((data.report as { detail?: string }).detail ? ['Details: ' + (data.report as { detail: string }).detail] : []),
          ] : []),
          data.loading ? 'Page is still loading.' : 'Input dispatched. Page outcome is not yet verified.',
        ].join('\n'),
      }
    }, { oneOf: [
      { required: ['action'], not: { required: ['steps'] } },
      { required: ['steps'], not: { required: ['action'] } },
    ] }, 'Act in a browser tab. Prefer element_ref from browser.read. Coordinate actions require x, y and latest observation_id; sequences support wait_for, screenshots, and multiple steps. Never blindly retry submissions.'),
    'browser.read': makeTool({
      tab_id: TAB_ID,
      width: { type: 'integer', minimum: 1, maximum: 4096, description: 'Optional AI-owned viewport width. Omit to preserve the current width.' },
      height: { type: 'integer', minimum: 1, maximum: 4096, description: 'Optional AI-owned viewport height. Omit to preserve the current height.' },
      view: { type: 'string', enum: ['combined', 'visual', 'structure', 'annotations'] },
      include_annotations: { type: 'boolean' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    }, ['tab_id'], async ({
      tab_id, width, height, view = 'combined', include_annotations = false, offset = 0, limit = 80,
    }, signal) => {
      if (width !== undefined || height !== undefined) resolveAgentViewport({ width, height })
      const { data, imageBase64 } = await requestTideCodeBrowser({
        operation: 'read',
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        projectPath: workspace,
        tabId: tab_id,
        view,
        includeAnnotations: include_annotations,
        offset,
        limit,
        conversationId: context.conversationId ?? null,
      }, signal)
      const png = imageBase64 ? Buffer.from(imageBase64, 'base64') : null
      if (png) context.captureModelOutput?.({
        type: 'content',
        value: [
          { type: 'text', text: '[Browser screenshot]\n' + String(data.body ?? '') },
          {
            type: 'file',
            data: { type: 'data', data: png },
            filename: 'browser-' + tab_id + '.png',
            mediaType: 'image/png',
          },
        ],
      })
      const saved = png && context.conversationId
        ? await storeChatImageAttachment({
            conversationId: context.conversationId,
            dataUrl: 'data:image/png;base64,' + imageBase64,
            fileName: 'browser-' + tab_id + '.png',
          })
        : null
      return {
        status: 'success',
        summary: 'Read browser ' + view,
        body: String(data.body ?? ''),
        ...(saved ? {
          resultPresentation: {
            kind: 'image' as const,
            fileName: saved.fileName,
            mediaType: 'image/png',
            relativePath: saved.path,
          },
        } : {}),
        semantics: {
          tab_id, width: data.width, height: data.height,
          ...(typeof data.observation_id === 'string' ? { observation_id: data.observation_id } : {}),
        },
      }
    }, {}, 'Read a browser tab. Use structure for element references, combined for screenshot plus elements, or visual for images. Returns observation_id for viewport-bound coordinate actions. Does not resize the user browser.'),
    'browser.devtools': makeTool({
      tab_id: TAB_ID,
      action: { type: 'string', enum: ['console', 'network', 'performance', 'evaluate', 'cdp'] },
      expression: STRING,
      method: STRING,
      parameters: { type: 'object', additionalProperties: true },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['tab_id', 'action'], async ({ tab_id, ...action }, signal) => {
      const { data } = await requestTideCodeBrowser({
        operation: 'devtools', projectPath: workspace, tabId: tab_id, input: action,
      }, signal)
      return {
        status: 'success',
        summary: 'Browser diagnostics: ' + action.action,
        body: 'Browser diagnostics: ' + action.action + '\n' + formatBrowserDiagnostics(data.output),
        semantics: { tab_id, action: action.action, output: data.output },
      }
    }, {}, 'Inspect browser console, network, performance, evaluation or CDP diagnostics. Use browser.read for normal page observations.'),
  }
}

/** Preserve every capture for model comparison; the existing disclosure previews the last image. */
async function presentSequenceCaptures(
  context: AgentToolContext,
  tabId: string,
  captures: BrowserSequenceCapture[],
  body: string,
): Promise<Pick<AgentToolExecutionResult, 'body' | 'resultPresentation'>> {
  const content: Extract<ToolResultOutput, { type: 'content' }>['value'] = [{ type: 'text', text: body }]
  let resultPresentation: AgentToolExecutionResult['resultPresentation']
  const savedImages: string[] = []
  for (const capture of captures) {
    if (!capture.imageBase64) {
      continue
    }
    const filename = 'browser-' + tabId + '-step-' + capture.step + '.png'
    content.push(
      { type: 'text', text: capture.label + ' (step ' + capture.step + ', '
        + capture.started_ms + '–' + capture.completed_ms + 'ms)\n' + capture.body },
      { type: 'file', data: { type: 'data', data: Buffer.from(capture.imageBase64, 'base64') }, filename, mediaType: 'image/png' },
    )
    if (context.conversationId) {
      const saved = await storeChatImageAttachment({
        conversationId: context.conversationId,
        dataUrl: 'data:image/png;base64,' + capture.imageBase64,
        fileName: filename,
      })
      savedImages.push(capture.label + ': ' + saved.path)
      resultPresentation = { kind: 'image', fileName: saved.fileName, mediaType: 'image/png', relativePath: saved.path }
    }
  }
  if (captures.some((capture) => capture.imageBase64)) {
    context.captureModelOutput?.({ type: 'content', value: content })
  }
  return {
    body: body + (savedImages.length ? '\n\nSaved captures:\n' + savedImages.join('\n') : ''),
    ...(resultPresentation ? { resultPresentation } : {}),
  }
}
