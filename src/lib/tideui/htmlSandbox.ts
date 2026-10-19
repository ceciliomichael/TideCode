import { buildHtmlPreviewBridge } from './htmlPreviewBridge'
import type { TideHtmlTheme } from './htmlTheme'

export const TIDE_HTML_LIMIT = 60_000

/**
 * srcdoc is placed in an iframe WITHOUT allow-same-origin.
 * CSP denies network, navigation and embedding; inline scripts stay isolated.
 */
export function buildTideHtmlDocument(source: string, token = crypto.randomUUID(), credential = crypto.randomUUID(), design?: { styles: string; theme: TideHtmlTheme }): string {
  if (source.length > TIDE_HTML_LIMIT) throw new Error('HTML preview exceeds 60 KB')
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "navigate-to 'none'",
    "img-src data:",
    "media-src 'none'",
    "font-src data:",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
  ].join('; ')
  const themeStyles = Object.entries(design?.theme.variables ?? {}).map(([name, value]) => `${name}:${value}`).join(';')
  const sharedStyles = `:root{${themeStyles}}\n${design?.styles ?? ''}\ntide-ui{display:block;min-width:0}`.replace(/<\/style/giu, '<\\/style')
  // Install CSP before untrusted content. Additional source policies cannot relax it.
  return `<!doctype html><html data-theme="${design?.theme.mode === 'dark' ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{font-family:var(--font-sans,system-ui);color-scheme:light dark;color:light-dark(#222,#eee);background:transparent;scrollbar-width:thin;scrollbar-color:#8886 transparent}body{display:flow-root;margin:0;overflow-wrap:anywhere}*,*::before,*::after{box-sizing:border-box}img,video,canvas,svg{max-width:100%}${sharedStyles}</style><script nonce="${token}">${buildHtmlPreviewBridge(token, credential)}</script></head><body>${source}</body></html>`
}
