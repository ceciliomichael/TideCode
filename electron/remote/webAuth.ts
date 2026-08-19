import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const REMOTE_SESSION_COOKIE_NAME = 'tidecode_remote_session'
export const REMOTE_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_AUTH_BODY_BYTES = 8 * 1024

interface SessionRecord { expiresAt: number }

function parseCookies(header: string | undefined) {
  const result = new Map<string, string>()
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key) result.set(key, value)
  }
  return result
}

export function getRemoteSessionId(request: IncomingMessage) {
  return parseCookies(request.headers.cookie).get(REMOTE_SESSION_COOKIE_NAME) ?? null
}

export class RemoteWebSessionStore {
  private readonly sessions = new Map<string, SessionRecord>()
  create(response: ServerResponse) {
    const sessionId = randomBytes(32).toString('base64url')
    this.sessions.set(sessionId, { expiresAt: Date.now() + REMOTE_SESSION_TTL_MS })
    response.setHeader('Set-Cookie', REMOTE_SESSION_COOKIE_NAME + '=' + sessionId + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + Math.floor(REMOTE_SESSION_TTL_MS / 1000))
    return sessionId
  }
  clear(response?: ServerResponse) {
    this.sessions.clear()
    if (response) response.setHeader('Set-Cookie', REMOTE_SESSION_COOKIE_NAME + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  }
  delete(request: IncomingMessage, response?: ServerResponse) {
    const sessionId = getRemoteSessionId(request)
    if (sessionId) this.sessions.delete(sessionId)
    if (response) response.setHeader('Set-Cookie', REMOTE_SESSION_COOKIE_NAME + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  }
  validate(request: IncomingMessage) {
    const sessionId = getRemoteSessionId(request)
    if (!sessionId) return null
    const record = this.sessions.get(sessionId)
    if (!record) return null
    if (record.expiresAt <= Date.now()) { this.sessions.delete(sessionId); return null }
    return sessionId
  }
  getRemainingMs(sessionId: string) {
    const record = this.sessions.get(sessionId)
    return record ? Math.max(0, record.expiresAt - Date.now()) : 0
  }
}

export async function readAuthJsonBody(request: IncomingMessage) {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += bytes.length
    if (total > MAX_AUTH_BODY_BYTES) throw new Error('Request body is too large.')
    chunks.push(bytes)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new Error('Invalid JSON request body.') }
}

export function writeJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}

export function getLoginPageHtml(credentialsConfigured: boolean) {
  const statusCopy = credentialsConfigured
    ? 'Sign in to control the TideCode workspace running on your desktop.'
    : 'Remote login has not been configured on the desktop app yet.'
  const disabled = credentialsConfigured ? '' : ' disabled'
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>TideCode Remote</title>' +
    '<style>:root{color-scheme:dark;font-family:Segoe UI,system-ui,sans-serif;background:#101113;color:#f3f4f4}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at top,#18201e 0,#111315 38%,#101113 72%)}main{width:min(420px,100%);border:1px solid #303337;background:rgba(23,24,27,.96);border-radius:20px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.4)}.eyebrow{margin:0 0 8px;color:#7fa59c;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.title{margin:0;font-size:24px;line-height:1.2;letter-spacing:-.02em}.status{margin:9px 0 22px;color:#aeb1b5;line-height:1.55;font-size:14px}.field{display:block;margin-top:15px}.field-label{display:block;color:#d4d5d7;font-size:13px;font-weight:600}.hint{display:block;margin-top:5px;color:#777c82;font-size:12px;line-height:1.4}input{width:100%;margin-top:8px;border:1px solid #3a3d42;background:#101114;color:#f6f7f7;border-radius:11px;padding:12px 13px;outline:none;box-shadow:none;font:inherit}input::placeholder{color:#666b70}input:focus,input:focus-visible{outline:none;box-shadow:none;border-color:#3a3d42}input:disabled{opacity:.55;cursor:not-allowed}button{width:100%;margin-top:22px;border:0;border-radius:11px;padding:12px 14px;background:#385f58;color:#f7f8f8;font:600 14px inherit;cursor:pointer;transition:background .15s ease,opacity .15s ease}button:hover:not(:disabled){background:#426f67}button:disabled{opacity:.5;cursor:not-allowed}#error{min-height:19px;margin-top:11px;color:#f08d7c;font-size:13px;line-height:1.45}.security{margin-top:18px;border-top:1px solid #2b2e32;padding-top:15px;color:#777c82;font-size:12px;line-height:1.5}@media(max-width:480px){body{padding:14px}main{padding:22px 18px;border-radius:16px}.title{font-size:22px}}</style></head><body><main><p class="eyebrow">Remote workspace</p><h1 class="title">TideCode Remote</h1><p class="status">' + statusCopy + '</p>' +
    '<form id="login-form"><label class="field"><span class="field-label">Username</span><input id="username" autocomplete="username" placeholder="Enter your Remote username"' + disabled + '><span class="hint">Use the username configured in Settings &gt; Remote on your desktop.</span></label><label class="field"><span class="field-label">Password</span><input id="password" type="password" autocomplete="current-password" placeholder="Enter your Remote password"' + disabled + '><span class="hint">This is the web access password set by the desktop app.</span></label><button type="submit"' + disabled + '>Sign in</button><div id="error" role="alert"></div></form><div class="security">Authentication applies only to browser access. The TideCode desktop app and CLI continue to use their normal local access.</div></main>' +
    '<script>const form=document.getElementById("login-form");form.addEventListener("submit",function(event){event.preventDefault();const error=document.getElementById("error");const button=form.querySelector("button");error.textContent="";button.disabled=true;const xhr=new XMLHttpRequest();xhr.open("POST","/remote/auth/login");xhr.setRequestHeader("Content-Type","application/json");xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){location.replace("/");return}let message="Unable to sign in.";try{message=JSON.parse(xhr.responseText).error||message}catch{}error.textContent=message;button.disabled=false};xhr.onerror=function(){error.textContent="Unable to sign in.";button.disabled=false};xhr.send(JSON.stringify({username:document.getElementById("username").value,password:document.getElementById("password").value}))});</script></body></html>'
}
