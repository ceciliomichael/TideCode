import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import type { JSONSchema7 } from '@ai-sdk/provider'
import { storeChatImageAttachment } from '../../../history/chatAttachments'
import { requestTideCodeBrowser } from '../../../runService/browserService'
import { resolveAgentViewport } from '../../../browser/agentViewport'
import type { AgentToolContext, AgentToolExecutionResult } from '../toolTypes'
import { createToolErrorResult, getToolErrorSummary } from './toolResult'

const STRING = { type: 'string' } as const
const TAB_ID = { type: 'string', minLength: 1 } as const
const ACTIONS = ['click', 'fill', 'type', 'key', 'scroll', 'navigate', 'back', 'forward', 'reload'] as const

interface BrowserToolInput {
  url: string
  new_tab?: boolean
  tab_id: string
  action: string
  element_ref?: string
  text?: string
  key?: string
  x?: number
  y?: number
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
  method?: string
  parameters?: Record<string, unknown>
}

function makeTool(
  properties: Record<string, JSONSchema7>,
  required: string[],
  execute: (input: BrowserToolInput) => Promise<AgentToolExecutionResult>,
) {
  return tool({
    description: 'TideCode native browser automation.',
    inputSchema: jsonSchema({ type: 'object', additionalProperties: false, properties, required }),
    execute: async (input) => {
      try {
        return await execute(input as BrowserToolInput)
      } catch (error) {
        return createToolErrorResult(getToolErrorSummary(error, 'Browser operation failed.'))
      }
    },
  })
}

function plainTabList(input: {
  page: number
  total: number
  has_more: boolean
  tabs: Array<{ tab_id: string; kind: string; title: string; url: string }>
}) {
  const rows = input.tabs.map((tab, index) => {
    const title = tab.title.replace(/[\r\n]/gu, ' ').slice(0, 100)
    const url = tab.url.replace(/[\r\n]/gu, '').slice(0, 1000)
    return [
      'Tab ' + ((input.page - 1) * 10 + index + 1),
      'Tab ID: ' + tab.tab_id,
      'Title: ' + title,
      'Kind: ' + tab.kind,
      'URL: ' + url,
    ].join('\n')
  })
  return [
    'Page ' + input.page + ' (10 per page, ' + input.total + ' tabs total).',
    ...rows.map((row) => '\n' + row),
    input.has_more ? 'More tabs: call with page ' + (input.page + 1) + '.' : 'No more tabs.',
  ].join('\n')
}

export function createBrowserToolSet(context: AgentToolContext): Record<string, ToolSet[string]> {
  const workspace = context.workspaceRootPath
  return {
    'browser.open': makeTool({
      url: { ...STRING, minLength: 1 },
      new_tab: { type: 'boolean' },
    }, ['url'], async ({ url, new_tab = false }) => {
      const { data } = await requestTideCodeBrowser({
        operation: 'open', projectPath: workspace, url, newTab: new_tab,
      })
      return {
        status: 'success',
        summary: data.status === 'reused' ? 'Reused browser tab' : 'Opened browser tab',
        body: [
          'Tab ID: ' + data.tab_id,
          'URL: ' + data.url,
          'Title: ' + (data.title || 'Untitled'),
          'Status: ' + data.status,
          ...(data.error ? ['Load error: ' + data.error] : []),
        ].join('\n'),
        semantics: { tab_id: data.tab_id, url: data.url, status: data.status },
      }
    }),
    'browser.tabs': makeTool({ page: { type: 'integer', minimum: 1 } }, [], async ({ page = 1 }) => {
      const { data } = await requestTideCodeBrowser({ operation: 'tabs', projectPath: workspace, page })
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
    }),
    'browser.terminate': makeTool({ tab_id: TAB_ID }, ['tab_id'], async ({ tab_id }) => {
      const { data } = await requestTideCodeBrowser({ operation: 'terminate', projectPath: workspace, tabId: tab_id })
      return {
        status: 'success',
        summary: data.status === 'closed' ? 'Closed browser tab' : 'Requested browser tab close',
        body: 'Tab ID: ' + tab_id + '\nStatus: ' + data.status,
      }
    }),
    'browser.interact': makeTool({
      tab_id: TAB_ID,
      action: { type: 'string', enum: [...ACTIONS] },
      element_ref: { ...STRING, description: 'Required target reference for click and fill, from browser.read.' },
      x: { type: 'number', description: 'Scroll anchor only, in viewport CSS pixels.' },
      y: { type: 'number', description: 'Scroll anchor only, in viewport CSS pixels.' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
      text: STRING,
      key: STRING,
      delta_x: { type: 'number' },
      delta_y: { type: 'number' },
      url: STRING,
    }, ['tab_id', 'action'], async ({ tab_id, ...action }) => {
      if (action.action === 'click'
        && (typeof action.element_ref !== 'string' || !action.element_ref.trim() || 'x' in action || 'y' in action)) {
        throw new Error('Browser clicks require an element_ref and do not accept x or y.')
      }
      if ((action.action === 'fill' && (!action.element_ref || typeof action.text !== 'string'))
        || (action.action === 'type' && typeof action.text !== 'string')
        || (action.action === 'key' && typeof action.key !== 'string')
        || (action.action === 'navigate' && typeof action.url !== 'string')) {
        throw new Error('The browser interaction is missing required action parameters.')
      }
      const { data } = await requestTideCodeBrowser({
        operation: 'interact', projectPath: workspace, tabId: tab_id, action,
      })
      return {
        status: 'success',
        summary: 'Browser ' + data.action,
        body: 'Action: ' + data.action + '\nURL: ' + data.url
          + '\nTitle: ' + (data.title || 'Untitled')
          + '\nLoading: ' + data.loading,
      }
    }),
    'browser.read': makeTool({
      tab_id: TAB_ID,
      width: { type: 'integer', minimum: 1, maximum: 4096, default: 1280, description: 'Viewport width in CSS pixels. Defaults to 1280.' },
      height: { type: 'integer', minimum: 1, maximum: 4096, default: 720, description: 'Viewport height in CSS pixels. Defaults to 720.' },
      view: { type: 'string', enum: ['combined', 'visual', 'structure', 'annotations'] },
      include_annotations: { type: 'boolean' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    }, ['tab_id'], async ({
      tab_id, width, height, view = 'combined', include_annotations = false, offset = 0, limit = 80,
    }) => {
      const viewport = resolveAgentViewport({ width, height })
      const { data, imageBase64 } = await requestTideCodeBrowser({
        operation: 'read',
        ...viewport,
        projectPath: workspace,
        tabId: tab_id,
        view,
        includeAnnotations: include_annotations,
        offset,
        limit,
        conversationId: context.conversationId ?? null,
      })
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
        semantics: { tab_id, width: data.width, height: data.height },
      }
    }),
    'browser.devtools': makeTool({
      tab_id: TAB_ID,
      action: { type: 'string', enum: ['console', 'network', 'performance', 'evaluate', 'cdp'] },
      expression: STRING,
      method: STRING,
      parameters: { type: 'object', additionalProperties: true },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['tab_id', 'action'], async ({ tab_id, ...action }) => {
      const { data } = await requestTideCodeBrowser({
        operation: 'devtools', projectPath: workspace, tabId: tab_id, input: action,
      })
      return {
        status: 'success',
        summary: 'Browser diagnostics: ' + action.action,
        body: '### ' + action.action + '\n\n'
          + JSON.stringify(data.output, null, 2).slice(0, 16_000),
        semantics: { tab_id, action: action.action },
      }
    }),
  }
}
