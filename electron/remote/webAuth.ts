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
  const statusCopy = credentialsConfigured ? 'Sign in with the username and password configured in TideCode Settings.' : 'Remote login has not been configured on the desktop app yet.'
  const disabled = credentialsConfigured ? '' : ' disabled'
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>TideCode Remote</title>' +
    '<style>:root{color-scheme:dark;font-family:Segoe UI,system-ui,sans-serif;background:#111214;color:#f2f2f2}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#111214}main{width:min(420px,100%);border:1px solid #34363a;background:#17181b;border-radius:18px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.35)}h1{margin:0;font-size:22px}p{color:#aeb0b5;line-height:1.5;font-size:14px}label{display:block;margin-top:16px;font-size:13px;color:#c7c8cc}input{width:100%;margin-top:7px;border:1px solid #3b3d42;background:#101114;color:#fff;border-radius:10px;padding:12px 13px;outline:none;font:inherit}input:focus{border-color:#7fa59c}button{width:100%;margin-top:18px;border:0;border-radius:10px;padding:12px 14px;background:#467b72;color:white;font:600 14px inherit;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}#error{min-height:20px;color:#f48771;margin-top:12px;font-size:13px}</style></head><body><main><h1>TideCode Remote</h1><p>' + statusCopy + '</p>' +
    '<form id="login-form"><label>Username<input id="username" autocomplete="username"' + disabled + '></label><label>Password<input id="password" type="password" autocomplete="current-password"' + disabled + '></label><button type="submit"' + disabled + '>Sign in</button><div id="error" role="alert"></div></form></main>' +
    '<script>const form=document.getElementById("login-form");form.addEventListener("submit",function(event){event.preventDefault();const error=document.getElementById("error");const button=form.querySelector("button");error.textContent="";button.disabled=true;const xhr=new XMLHttpRequest();xhr.open("POST","/remote/auth/login");xhr.setRequestHeader("Content-Type","application/json");xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){location.replace("/");return}let message="Unable to sign in.";try{message=JSON.parse(xhr.responseText).error||message}catch{}error.textContent=message;button.disabled=false};xhr.onerror=function(){error.textContent="Unable to sign in.";button.disabled=false};xhr.send(JSON.stringify({username:document.getElementById("username").value,password:document.getElementById("password").value}))});</script></body></html>'
}
