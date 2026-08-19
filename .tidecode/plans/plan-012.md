---
status: draft
---

# Remote Settings and Web Authentication

# Remote Settings, Web Authentication, and Host Management

Status: proposed

## Objective

Move TideCode Remote host management into a first-class **Settings > Remote** page and remove the floating remote-access overlay from the main app. The Remote page becomes the canonical place to configure and inspect web remote access.

This milestone covers the desktop-hosted web client only. Desktop Electron usage and the TideCode CLI continue to use their existing local runtime paths and must never be blocked by Remote web authentication.

## Product Decisions

- Add **Remote** to Settings immediately above **Updates**.
- Preserve the existing Updates settings item id to avoid breaking any existing deep links or launch requests. Add Remote with a new id and place it before Updates in display order.
- Remove the floating bottom-right Remote URL/status indicator from the main TideCode UI. Remote status belongs in Settings > Remote.
- The remote host still runs on the laptop and serves the browser UI from the laptop.
- The configured port defaults to **38472** and can be changed from Settings > Remote.
- Show every usable IPv4 access URL detected on the host, not only the preferred Wi-Fi/Ethernet URL. This intentionally includes secondary adapters such as Tailscale, ZeroTier, Ethernet, Wi-Fi, and other reachable interfaces.
- Continue ranking ordinary physical LAN interfaces first for the primary URL, but label detected interfaces so users can intentionally choose a Tailscale or other overlay-network address.
- Add optional **web-only username/password authentication**.
- Remote authentication applies only to HTTP/browser and remote WebSocket traffic. It does not alter Electron preload IPC, local desktop features, local history/runtime access, or CLI behavior.
- Authentication uses a browser login page and an authenticated session cookie. Do not place credentials in URLs, WebSocket query strings, localStorage, or RPC payloads.
- A password is never returned back to the renderer after being saved.
- Existing same-origin WebSocket enforcement remains in place in addition to login authentication.

## Current Architecture to Build On

- Remote server: `electron/remote/host.ts`
- Electron remote host bridge: `electron/preload.ts` and `src/remote/protocol.ts`
- Browser bridge: `src/remote/webBridge.ts`
- Desktop bridge/event fan-out: `src/remote/desktopBridge.ts`
- Settings navigation: `src/components/settings/settingsItems.ts`
- Settings content routing: `src/components/settings/SettingsContent.tsx`
- App settings type/defaults/store: `src/types/chat/settings.ts`, `src/lib/defaultAppSettings.ts`, `electron/settings/store.ts`
- Main-process host lifecycle: `electron/main.ts`

The current host starts on `0.0.0.0`, defaults to port 38472, enumerates IPv4 interface URLs, enforces same-origin WebSocket upgrades, and serves the existing React renderer. The current health response explicitly reports unauthenticated LAN access and must be updated when auth is implemented.

## Phase 1: Remote Settings Surface

### Navigation

- Add a new Settings item labeled **Remote** above Updates.
- Keep Updates on its existing id and assign Remote a new id.
- Add `src/components/settings/remote/RemoteSettingsPanel.tsx` and any focused supporting hooks/components under the same folder.
- Wire the panel through `SettingsContent.tsx`.

### Remote page layout

Create sections roughly equivalent to:

#### Remote access

- Status: Running / Restarting / Stopped / Error
- Configured port
- Actual bound port
- Connected browser count
- Primary access URL with Copy button
- All detected access URLs with interface labels
- Clear explanatory text that TideCode must be open for this LAN-hosted mode

Example display:

`http://192.168.1.9:38472`  Wi-Fi
`http://100.x.y.z:38472`   Tailscale
`http://10.x.x.x:38472`    Ethernet / secondary adapter

Do not hide virtual/overlay adapters. Rank them after physical LAN addresses, but expose them all.

#### Network

- Port numeric field
- Default: 38472
- Accept only valid user ports. Prefer 1024 through 65535 for normal UI configuration.
- Save/restart action or immediate controlled restart after a committed valid change.
- If the new port cannot bind, preserve the saved configuration only if the product can clearly recover. Preferred behavior is transactional: attempt restart on the new port, report failure, and retain/restart the previous working port.
- Keep `TIDECODE_REMOTE_PORT` as a developer/test override if still useful, with explicit precedence documented in code. Recommended precedence: environment override for dev/test, otherwise persisted Remote setting.

#### Web authentication

- Toggle: **Require login for web access**
- Username field
- New password field
- Confirm password field when setting/changing credentials
- Save credentials button
- Clear/change credentials action
- Show only `Password configured`, never the stored password
- Changing credentials invalidates all existing remote browser sessions immediately
- Disabling authentication invalidates current sessions and reverts to same-origin-only LAN access

## Phase 2: Settings and Host Configuration Model

Add explicit Remote configuration types rather than scattering fields through unrelated settings logic.

Recommended durable fields in `AppSettings`:

- `remotePort: number`
- `remoteWebAuthEnabled: boolean`
- `remoteWebUsername: string`

Do **not** store a plaintext password in `AppSettings` or `settings.json`.

Add normalization in `electron/settings/store.ts`:

- port fallback to 38472
- trim username
- boolean auth flag
- if auth is enabled but no valid credential verifier exists, host must fail closed for protected web requests and Settings should show that credentials must be configured

The remote host must be able to receive updated configuration after app startup. Refactor it from constructor-only `preferredPort` configuration to a runtime configuration API, for example:

- `start(config)`
- `restart(config)`
- `applyConfiguration(config)`
- `stop()`

The implementation should serialize lifecycle changes so rapid port/settings edits cannot create two listeners or race stop/start operations.

## Phase 3: Credential Storage

Create a dedicated main-process Remote credential store, separate from renderer-visible settings.

Recommended implementation:

- `electron/remote/authStore.ts`
- use Node built-in `crypto.scrypt` with a random salt to derive a password verifier
- compare with `timingSafeEqual`
- persist only username-associated verifier metadata such as algorithm/version, salt, and derived hash
- never persist plaintext password
- never expose verifier/salt to the web client
- expose only credential status to the Electron settings UI, such as `configured: true`

Electron `safeStorage` is already used elsewhere and can be used if implementation needs encrypted secret material, but a one-way password verifier is preferred because the original password does not need to be recoverable.

Credential writes should be atomic and live under TideCode user data/config storage with dev and packaged profiles remaining isolated in the same way as other TideCode state.

## Phase 4: Browser Authentication Flow

### Unauthenticated state

When `remoteWebAuthEnabled` is false:

- preserve current same-origin browser behavior
- browser can load TideCode and open `/remote/ws` without a TideCode login

When enabled:

- normal TideCode renderer files are not served to unauthenticated clients
- WebSocket upgrades are rejected for unauthenticated clients
- remote control RPC is therefore unreachable without a valid session

### Login routes

Add focused host endpoints such as:

- `GET /remote/auth/status`
- `POST /remote/auth/login`
- `POST /remote/auth/logout`

The login request accepts username/password over the HTTP request body, validates against the local credential verifier, and on success issues a random opaque session id.

### Sessions

- Store remote web sessions in memory in the desktop host
- Send session id in an `HttpOnly`, `SameSite=Strict` cookie
- Use an appropriate Path covering the remote application and WebSocket endpoint
- Do not expose the session token to React JavaScript unless technically unavoidable
- Add expiration/idle timeout, for example 24 hours with activity refresh, with the exact duration centralized as a constant
- Clear all sessions when credentials change, auth is disabled, host restarts, or app exits
- WebSocket upgrade validates the cookie before `handleUpgrade`
- Continue validating Origin/Host even when a valid session exists

### Login UI

Serve a small login view when the remote browser is unauthenticated. It should visually match TideCode but must not bootstrap the full privileged React application until login succeeds.

After successful login:

1. browser receives session cookie
2. browser navigates/reloads to the normal TideCode page
3. normal React web bridge boots
4. WebSocket connects using the session cookie automatically

On 401/session expiration, the web client returns to the login view rather than repeatedly reconnecting.

## Phase 5: Remote Host Status API

Expand `RemoteHostStatus` in `src/remote/protocol.ts` so Settings can render useful state without parsing URLs itself.

Recommended shape includes:

- `enabled`
- `error`
- `connectedClientCount`
- `configuredPort`
- `boundPort`
- `primaryUrl`
- `addresses: Array<{ interfaceName, address, url, kind }>`
- `webAuthEnabled`
- `webCredentialsConfigured`
- lifecycle state such as `starting | running | restarting | stopped | error`

Keep compatibility aliases only if needed during migration, then simplify callers.

Extend `TideCodeRemoteHostBridgeApi` with desktop-only management operations such as:

- `getStatus()`
- `restart({ port })`
- `setWebCredentials(...)`
- `clearWebCredentials()`
- existing `onStatus(...)`

These operations are exposed through Electron preload to the trusted desktop settings UI. They must **not** be included in the remote browser RPC namespace, otherwise a logged-in browser could alter the host authentication boundary itself.

## Phase 6: Settings Synchronization and Restart Semantics

Port and auth configuration are host-level settings, not per-workspace UI state.

When desktop Settings changes the port:

1. validate input
2. update/apply host configuration through trusted Electron IPC
3. host closes current remote clients with an explicit restart close reason
4. host binds the new port
5. status updates with new URLs
6. persisted setting is committed only according to the selected transactional policy

When credentials/auth mode change:

1. persist username/auth preference and verifier as applicable
2. invalidate existing remote sessions
3. disconnect existing web sockets if the security boundary changed
4. require browsers to log in again when auth is enabled or credentials changed
5. desktop and CLI continue uninterrupted

The Settings panel subscribes to host status events so it updates live without polling.

## Phase 7: Security Boundaries

Required controls:

- Authentication affects **web HTTP + WebSocket only**
- Electron desktop IPC bypasses web login by design
- CLI remains unchanged by web login
- same-origin WebSocket check remains mandatory
- no wildcard CORS
- no credential or session token in URL fragments/query strings
- no plaintext password persistence
- no password returned through settings APIs
- session cookies are HttpOnly and SameSite=Strict
- login failures return generic invalid-credentials responses
- add basic login throttling/backoff per source address to reduce trivial brute-force attempts
- cap request body sizes on auth endpoints
- keep existing WebSocket max payload cap
- invalidate sessions when auth settings change
- `/remote/health` must not leak sensitive configuration and should reflect whether authentication is required without exposing credentials

Important limitation: the current LAN host is plain HTTP. Username/password authentication prevents unauthorized application use but does **not** provide transport confidentiality on an untrusted LAN. Tailscale/ZeroTier can provide encrypted network transport externally. Native HTTPS can be a later hardening milestone if needed.

## Phase 8: Remove Floating Remote Indicator

- Remove `RemoteAccessIndicator` from `src/App.tsx`.
- Do not replace it with another persistent floating badge.
- Remote URL, status, connected client count, copy controls, and errors live in Settings > Remote.
- The existing component file can be deleted once no longer referenced or its logic can be reused internally by the Remote settings panel if that reduces duplication.

This source-level removal has already been started by removing the indicator import/render from `src/App.tsx`; implementation work should verify and clean up any now-dead component code.

## Phase 9: Tests

### Host configuration tests

- defaults to port 38472
- configured port binds successfully
- invalid port is rejected/sanitized
- occupied port reports a useful error and recovers according to transactional restart policy
- all IPv4 interface addresses are exposed with deterministic ranking
- physical LAN is preferred over WSL/Docker/other virtual adapters
- Tailscale/ZeroTier addresses remain visible instead of being filtered out

### Authentication tests

- auth disabled allows same-origin browser access
- auth enabled blocks renderer files without a session
- auth enabled blocks WebSocket upgrade without a session
- wrong username/password is rejected
- correct login sets session cookie
- authenticated page and WebSocket access work
- logout invalidates session
- credential change invalidates all sessions
- auth disable/enable transition behaves correctly
- password/verifier never appears in Remote status or renderer settings payloads
- same-origin enforcement still rejects cross-origin WebSocket attempts even with auth

### Regression tests

- desktop UI works without Remote login
- CLI works without Remote login
- chat/history/run synchronization still works after login
- shared terminal behavior still works after login
- terminal close synchronization still works
- Settings updates do not recursively expose privileged host-management methods to the remote browser

### Verification commands

- `npm run typecheck`
- focused ESLint on changed files
- relevant Remote/auth unit tests
- `npm test`
- `npm run build`
- live desktop + browser smoke test on normal LAN IP
- live smoke test using a secondary adapter/Tailscale URL when available

## Acceptance Criteria

The milestone is complete when all of the following are true:

- Settings contains Remote directly above Updates.
- Main app no longer shows the floating bottom-right Remote indicator.
- Remote page shows running state, connected clients, configured/bound port, preferred URL, and every detected usable interface URL.
- User can change the port and the host restarts cleanly on that port.
- User can enable web login and configure username/password from the desktop app.
- Password is not stored in plaintext and cannot be read back through renderer APIs.
- An unauthenticated browser cannot load the privileged TideCode web UI or open the remote WebSocket when login is required.
- An authenticated browser can use the same TideCode web UI and all existing remote synchronization features.
- Changing credentials invalidates existing browser sessions.
- Electron desktop and CLI remain usable regardless of Remote web authentication state.
- LAN/Tailscale/other detected addresses are visible so users can choose the route appropriate to their network.
- Typecheck, tests, build, and live browser smoke tests pass.

## Out of Scope for This Milestone

- Cloud account login for `console.tidecode.com`
- cloud relay/tunnel implementation
- OAuth/social login
- native mobile app packaging
- mobile responsive redesign itself
- public internet exposure configuration
- automatic TLS certificate issuance
- running Remote while the TideCode desktop host is closed
