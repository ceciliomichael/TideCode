import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const REMOTE_SESSION_COOKIE_NAME = 'tidecode_remote_session'
export const REMOTE_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_AUTH_BODY_BYTES = 8 * 1024

interface SessionRecord {
  expiresAt: number
  originHost: string | null
}

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

function getOriginHost(request: IncomingMessage) {
  const origin = request.headers.origin
  if (!origin) return null
  try {
    return new URL(origin).host.toLowerCase()
  } catch {
    return null
  }
}

export class RemoteWebSessionStore {
  private readonly sessions = new Map<string, SessionRecord>()
  create(request: IncomingMessage, response: ServerResponse) {
    const sessionId = randomBytes(32).toString('base64url')
    this.sessions.set(sessionId, {
      expiresAt: Date.now() + REMOTE_SESSION_TTL_MS,
      originHost: getOriginHost(request),
    })
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
  matchesOrigin(sessionId: string, request: IncomingMessage) {
    const record = this.sessions.get(sessionId)
    const originHost = getOriginHost(request)
    return Boolean(record?.originHost && originHost && record.originHost === originHost)
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
    '<style>:root{color-scheme:dark;font-family:Segoe UI,system-ui,sans-serif;background:#101113;color:#f3f4f4}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;background:#101113}main{width:min(420px,100%);border:1px solid #303337;background:rgba(23,24,27,.96);border-radius:20px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.4)}.eyebrow{margin:0 0 8px;color:#7fa59c;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.title{margin:0;font-size:24px;line-height:1.2;letter-spacing:-.02em}.status{margin:9px 0 22px;color:#aeb1b5;line-height:1.55;font-size:14px}.field{display:block;margin-top:15px}.field-label{display:block;color:#d4d5d7;font-size:13px;font-weight:600}.hint{display:block;margin-top:5px;color:#777c82;font-size:12px;line-height:1.4}input{width:100%;margin-top:8px;border:1px solid #3a3d42;background:#101114;color:#f6f7f7;border-radius:11px;padding:12px 13px;outline:none;box-shadow:none;font:inherit}.password-input{position:relative}.password-input input{padding-right:46px}.password-toggle{position:absolute;right:0;top:8px;display:flex;width:44px;height:44px;align-items:center;justify-content:center;margin:0;padding:0;border:0;background:transparent;color:#8b8f94}.password-toggle:hover:not(:disabled){background:transparent;color:#f3f4f4}.password-toggle:focus,.password-toggle:focus-visible{outline:none;box-shadow:none}.password-toggle svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.password-toggle .eye-off{display:none}input::placeholder{color:#666b70}input:focus,input:focus-visible{outline:none;box-shadow:none;border-color:#3a3d42}input:disabled{opacity:.55;cursor:not-allowed}button{width:100%;margin-top:22px;border:0;border-radius:11px;padding:12px 14px;background:#385f58;color:#f7f8f8;font:600 14px inherit;cursor:pointer;transition:background .15s ease,opacity .15s ease}button:hover:not(:disabled){background:#426f67}button:disabled{opacity:.5;cursor:not-allowed}#error{min-height:19px;margin-top:11px;color:#f08d7c;font-size:13px;line-height:1.45}@media(max-width:480px){body{padding:14px}main{padding:22px 18px;border-radius:16px}.title{font-size:22px}}</style></head><body><main><p class="eyebrow">Remote workspace</p><h1 class="title">TideCode Remote</h1><p class="status">' + statusCopy + '</p>' +
    '<form id="login-form"><label class="field"><span class="field-label">Username</span><input id="username" autocomplete="username" placeholder="Enter your Remote username"' + disabled + '><span class="hint">Use the username configured in Settings &gt; Remote on your desktop.</span></label><label class="field"><span class="field-label">Password</span><div class="password-input"><input id="password" type="password" autocomplete="current-password" placeholder="Enter your Remote password"' + disabled + '><button id="password-toggle" class="password-toggle" type="button" aria-label="Show password"' + disabled + '><svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.1 12s3.6-7 9.9-7 9.9 7 9.9 7-3.6 7-9.9 7-9.9-7-9.9-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg class="eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"></path><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.3 0 9.9 8 9.9 8a18 18 0 0 1-3 4.1"></path><path d="M6.6 6.6C3.8 8.5 2.1 12 2.1 12s3.6 8 9.9 8c1.6 0 3-.5 4.2-1.2"></path></svg></button></div><span class="hint">This is the web access password set by the desktop app.</span></label><button type="submit"' + disabled + '>Sign in</button><div id="error" role="alert"></div></form></main>' +
    '<script>const form=document.getElementById("login-form");const password=document.getElementById("password");const passwordToggle=document.getElementById("password-toggle");if(passwordToggle){passwordToggle.addEventListener("click",function(){const showing=password.type==="text";password.type=showing?"password":"text";passwordToggle.setAttribute("aria-label",showing?"Show password":"Hide password");passwordToggle.querySelector(".eye").style.display=showing?"":"none";passwordToggle.querySelector(".eye-off").style.display=showing?"none":"block"})}form.addEventListener("submit",function(event){event.preventDefault();const error=document.getElementById("error");const button=form.querySelector("button[type=\\"submit\\"]");error.textContent="";button.disabled=true;const xhr=new XMLHttpRequest();xhr.open("POST","/remote/auth/login");xhr.setRequestHeader("Content-Type","application/json");xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){location.replace("/");return}let message="Unable to sign in.";try{message=JSON.parse(xhr.responseText).error||message}catch{}error.textContent=message;button.disabled=false};xhr.onerror=function(){error.textContent="Unable to sign in.";button.disabled=false};xhr.send(JSON.stringify({username:document.getElementById("username").value,password:document.getElementById("password").value}))});</script></body></html>'
}
