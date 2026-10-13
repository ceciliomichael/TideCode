import type { IncomingMessage, ServerResponse } from 'node:http'

export { RemoteWebSessionStore, REMOTE_SESSION_COOKIE_NAME, REMOTE_SESSION_TTL_MS, getRemoteSessionId } from './sessionStore'

const MAX_AUTH_BODY_BYTES = 8 * 1024

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

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="theme-color" content="#eef1ef">
<title>TideCode Remote</title>
<script>
(function(){
  var storageKey='tidecode:appearance';
  var appearance='system';
  try {
    var cached=window.localStorage.getItem(storageKey);
    if(cached==='light'||cached==='dark'||cached==='system') appearance=cached;
  } catch {}
  var dark=appearance==='dark'||(appearance==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  var theme=dark?'dark':'light';
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content',dark?'#131314':'#eef1ef');
})();
</script>
<style>
:root{
  color-scheme:light;
  font-family:Segoe UI,system-ui,sans-serif;
  --background:#f6f7f6;
  --surface:#ffffff;
  --surface-muted:#f0f2f0;
  --surface-hover:#e9ecea;
  --border:#d4d9d5;
  --foreground:#202221;
  --muted:#666b68;
  --subtle:#8a908c;
  --brand:#315f59;
  --brand-soft:#d9e9e6;
  --action:#d9e9e6;
  --action-hover:#cfe2de;
  --action-foreground:#315f59;
  --action-outline:var(--border);
  --danger:#b4232d;
  --shadow:0 28px 80px rgb(23 31 27 / .14);
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --background:#0f0f10;
  --surface:#171718;
  --surface-muted:#202022;
  --surface-hover:#2a2a2d;
  --border:#38383d;
  --foreground:#e9e9ea;
  --muted:#b5b5b8;
  --subtle:#8f8f95;
  --brand:#87aea4;
  --brand-soft:#223630;
  --action:#223630;
  --action-hover:#2a443d;
  --action-foreground:#ffffff;
  --action-outline:transparent;
  --danger:#f48771;
  --shadow:0 28px 80px rgb(0 0 0 / .46);
}
*{box-sizing:border-box}
html,body{min-height:100%;background:var(--background);color:var(--foreground)}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px;background:var(--background)}
main{width:min(420px,100%);border:1px solid var(--border);background:var(--surface);border-radius:24px;padding:32px;box-shadow:var(--shadow)}
.brand{display:flex;align-items:center;gap:11px;margin-bottom:26px;color:var(--brand);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.brand-mark{display:grid;width:30px;height:30px;place-items:center;border-radius:9px;background:var(--brand-soft);color:var(--brand);font-size:15px;letter-spacing:0}
.title{margin:0;font-size:27px;line-height:1.15;letter-spacing:-.025em}
.status{margin:10px 0 26px;color:var(--muted);line-height:1.55;font-size:14px}
 .field{display:block;margin-top:18px}
.field-label{display:block;color:var(--foreground);font-size:13px;font-weight:600}
.input-shell{position:relative;margin-top:8px}
.input-icon{position:absolute;left:15px;top:50%;width:18px;height:18px;transform:translateY(-50%);color:var(--subtle);pointer-events:none}
.input-icon svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
input{display:block;width:100%;height:48px;margin:0;border:1px solid var(--border);background:var(--surface-muted);color:var(--foreground);border-radius:12px;padding:0 14px 0 45px;outline:none;box-shadow:none;font:inherit;line-height:24px;transition:border-color .15s ease,background .15s ease}
input::placeholder{color:var(--subtle)}
input:hover:not(:disabled){background:var(--surface-hover)}
.password-input input{padding-right:50px}
.password-toggle{position:absolute;right:0;top:0;display:flex;width:48px;height:48px;align-items:center;justify-content:center;margin:0;padding:0;border:0;background:transparent;color:var(--muted);cursor:pointer}
.password-toggle:hover:not(:disabled){background:transparent;color:var(--foreground)}
.password-toggle:focus,.password-toggle:focus-visible{outline:none;box-shadow:none}
.password-toggle svg{display:block;width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.password-toggle .eye-off{display:none}
input:focus,input:focus-visible{outline:none;box-shadow:none;border-color:var(--brand)}
input:disabled{opacity:.55;cursor:not-allowed}
.hint{display:block;margin-top:6px;color:var(--subtle);font-size:12px;line-height:1.4}
.remember-row{display:flex;align-items:center;gap:9px;margin-top:20px;color:var(--muted);font-size:13px;line-height:20px;cursor:pointer}
.remember-row input{width:16px;height:16px;margin:0;padding:0;accent-color:var(--brand);cursor:pointer}
.remember-row input:focus,.remember-row input:focus-visible{box-shadow:none}
.remember-row input:disabled{cursor:not-allowed}
button.submit{width:100%;height:48px;margin-top:24px;border:0;border-radius:12px;padding:0 14px;background:var(--action);color:var(--action-foreground);box-shadow:inset 0 0 0 1px var(--action-outline);font:600 14px inherit;line-height:24px;cursor:pointer;transition:background .15s ease,opacity .15s ease}
button.submit:hover:not(:disabled){background:var(--action-hover)}
button:disabled{opacity:.5;cursor:not-allowed}
#error{min-height:20px;margin-top:11px;color:var(--danger);font-size:13px;line-height:1.45}
@media(max-width:480px){body{padding:14px}main{padding:25px 20px;border-radius:19px}.title{font-size:24px}}
</style>
</head>
<body>
<main>
  <div class="brand"><span class="brand-mark" aria-hidden="true">T</span><span>Remote workspace</span></div>
  <h1 class="title">TideCode Remote</h1>
  <p class="status">${statusCopy}</p>
  <form id="login-form">
    <label class="field">
      <span class="field-label">Username</span>
      <div class="input-shell">
        <span class="input-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle></svg></span>
        <input id="username" autocomplete="username" placeholder="Enter your Remote username"${disabled}>
      </div>
      <span class="hint">Use the username configured in Settings &gt; Remote on your desktop.</span>
    </label>
    <label class="field">
      <span class="field-label">Password</span>
      <div class="input-shell password-input">
        <span class="input-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg></span>
        <input id="password" type="password" autocomplete="current-password" placeholder="Enter your Remote password"${disabled}>
        <button id="password-toggle" class="password-toggle" type="button" aria-label="Show password"${disabled}>
          <svg class="eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.1 12s3.6-7 9.9-7 9.9 7 9.9 7-3.6 7-9.9 7-9.9-7-9.9-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          <svg class="eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7"></path><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.3 0 9.9 8 9.9 8a18 18 0 0 1-3 4.1"></path><path d="M6.6 6.6C3.8 8.5 2.1 12 2.1 12s3.6 8 9.9 8c1.6 0 3-.5 4.2-1.2"></path></svg>
        </button>
      </div>
      <span class="hint">This is the web access password set by the desktop app.</span>
    </label>
    <label class="remember-row"><input id="remember-me" type="checkbox"${disabled}><span>Keep me signed in on this device</span></label>
    <button class="submit" type="submit"${disabled}>Sign in</button>
    <div id="error" role="alert"></div>
  </form>
</main>
<script>
const form=document.getElementById("login-form");
const username=document.getElementById("username");
const password=document.getElementById("password");
const rememberMe=document.getElementById("remember-me");
const passwordToggle=document.getElementById("password-toggle");
const REMEMBER_KEY="tidecode.remote.remember-session";
try{rememberMe.checked=window.localStorage.getItem(REMEMBER_KEY)!=="false"}catch{rememberMe.checked=true}
rememberMe.addEventListener("change",function(){try{window.localStorage.setItem(REMEMBER_KEY,rememberMe.checked?"true":"false")}catch{}});
if(passwordToggle){passwordToggle.addEventListener("click",function(){const showing=password.type==="text";password.type=showing?"password":"text";passwordToggle.setAttribute("aria-label",showing?"Show password":"Hide password");passwordToggle.querySelector(".eye").style.display=showing?"":"none";passwordToggle.querySelector(".eye-off").style.display=showing?"none":"block"})}
form.addEventListener("submit",function(event){event.preventDefault();const error=document.getElementById("error");const button=form.querySelector(".submit");error.textContent="";try{window.localStorage.setItem(REMEMBER_KEY,rememberMe.checked?"true":"false")}catch{}button.disabled=true;const xhr=new XMLHttpRequest();xhr.open("POST","/remote/auth/login");xhr.setRequestHeader("Content-Type","application/json");xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){location.replace("/");return}let message="Unable to sign in.";try{message=JSON.parse(xhr.responseText).error||message}catch{}error.textContent=message;button.disabled=false};xhr.onerror=function(){error.textContent="Unable to sign in.";button.disabled=false};xhr.send(JSON.stringify({username:username.value,password:password.value,rememberMe:rememberMe.checked}))});
</script>
</body>
</html>`
}
