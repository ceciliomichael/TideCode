---
status: draft
---

---
status: active
---

# TideCode Remote Workspace

Status: active

This plan is the canonical tracker for TideCode Remote Workspace. It supersedes the remote portion of docs/plan/plan-003.md. The existing TideCode CLI is considered implemented and is not part of this plan except where shared runtime behavior must remain compatible.

## 1. Product Goal

Allow a user to open TideCode on their laptop, enable Remote Access, then access essentially the same TideCode experience from another device on the same network through a browser such as:

```text
http://192.168.1.9:38472
```

The laptop remains the host and source of truth. The remote browser is another TideCode client, not another TideCode runtime.

A prompt submitted from the web client must execute on the laptop against the same workspace, models, conversations, MCP servers, files, Git repository, terminal sessions, and agent runtime available to the desktop application. Changes and live events must be visible across connected clients.

The same architecture must later support access through a hosted entry point such as `console.tidecode.com` without requiring the remote UI or TideCode runtime model to be redesigned.

## 2. Core Product Principles

1. **One host, multiple clients.** The running TideCode desktop application owns local execution and durable state. Desktop React, web React, and CLI are clients of the same TideCode capabilities.
2. **No duplicated agent runtime.** Remote prompts use the existing canonical chat and run services. The browser never executes repository tools locally.
3. **Shared conversations.** Conversation IDs, messages, run state, checkpoints, titles, modes, and follow-ups are the same records used by desktop and CLI.
4. **Live synchronization.** A turn started from one client must be observable from another while it is still running, not only after persistence completes.
5. **Shared terminal sessions.** A terminal is a TideCode host resource with multiple subscribers, not a resource owned by one Electron WebContents.
6. **Same UI codebase.** Reuse the existing React application and components. Introduce transport abstraction rather than create a separate remote UI implementation.
7. **Mobile-first responsive behavior.** Preserve TideCode capabilities while adapting layout for phone and tablet screens.
8. **TypeScript first.** Keep the host, protocol, web client, and initial relay implementation in TypeScript. Do not introduce Go or Rust unless a later concrete systems requirement justifies it.
9. **Explicit web security boundary.** Remote control grants effective access to local source code, terminals, Git, tools, and potentially sensitive context. The LAN web surface supports optional username/password authentication managed only by the desktop app. Desktop and CLI are not gated by web credentials.
10. **LAN first, cloud second.** Direct local-network access is the first production-quality vertical slice. Cloud relay support is built afterward on the same client protocol.

## 3. Verified Implementation Snapshot

Verified on 2026-08-19 on branch `feat/remote-mobile-workspace`:

- [x] TideCode Desktop serves the same React application over the LAN through an HTTP/WebSocket Remote host.
- [x] Browser RPC is forwarded into the running desktop renderer through a validated compatibility bridge, so browser actions use the same preload-backed TideCode services instead of a second agent/runtime implementation.
- [x] The host exposes detected LAN/overlay addresses and a configurable port in **Settings → Remote**. The current machine correctly prefers its Wi-Fi address over virtual WSL/Hyper-V adapters.
- [x] Optional browser-only username/password authentication uses a one-way scrypt password verifier plus HttpOnly SameSite session cookies. WebSocket access is gated by the authenticated session when auth is enabled. Desktop and CLI do not require these credentials.
- [x] Browser and desktop share canonical conversation/history/run APIs and live event channels. History/settings invalidation is broadcast so remote mutations reconcile into the desktop UI.
- [x] The browser terminal resolves through the same desktop renderer identity and deterministic terminal session key, so desktop and browser attach to the same PTY. Explicit terminal-tab-close events synchronize tab removal across clients.
- [x] Mobile phone mode uses a single-surface layout with **Chat / Terminal / Board** as the only persistent bottom destinations.
- [x] Main app sidebar and Settings navigation open as full-screen mobile surfaces. Desktop-only workspace panel controls are removed from phone UI.
- [x] Provider, Codex, Model, MCP, Skill, New Thread, and Board task actions retain dialog/modal behavior where appropriate and are constrained to the dynamic mobile viewport.
- [x] A real Chromium run at **390 × 844** verified Chat, full-screen sidebar, New Thread, Terminal, Board, Board task create/details, Settings navigation, all major Settings pages, and Provider/Model/MCP/Skill dialogs with no horizontal overflow or runtime exceptions.
- [x] Final verification: `npm run typecheck`, `npm test` (**1112/1112**), and `npm run build` including renderer, Electron main/preload, run service, CLI, and console CLI runtime.
- [ ] Physical iOS/Android software-keyboard behavior, phone landscape, and tablet breakpoints still require device-level validation.
- [ ] PWA installability is not implemented.
- [ ] Cloud relay and `console.tidecode.com` are not implemented.

### Material implementation decisions

1. **LAN auth changed from pairing tokens to optional username/password.** Earlier QR/device-pairing requirements are superseded for the current LAN phase. Account/machine pairing can be introduced with the future cloud relay.
2. **The desktop renderer is the current LAN compatibility bridge.** Instead of first migrating all React code to a new aggregate `TideCodeClient` object, the browser installs compatible `window.tidecode*` APIs before React boots and forwards RPC through the running desktop renderer. This preserves one React UI and one canonical runtime with much less migration risk.
3. **Terminal sharing currently reuses the desktop renderer owner.** This satisfies LAN desktop/browser PTY sharing today, but a future independent daemon/cloud topology may still require the deeper host-owned multi-subscriber terminal refactor described later in this plan.
4. **Remote management remains desktop-only.** `window.tidecodeRemoteHost` is a trusted preload API and is intentionally not exposed to the remote browser RPC surface.
5. **No floating Remote badge.** Remote status, addresses, port, and web-auth configuration live under **Settings → Remote**.

## 4. Target Architecture

```text
                         TideCode Host on Laptop
                    Electron Main / Node / TypeScript

        +--------------------------------------------------+
        | Conversation history and canonical run state     |
        | Chat and agent runtime                           |
        | Workspace and filesystem services                |
        | Git services                                     |
        | Terminal PTYs                                    |
        | MCP and skills                                   |
        | Provider and model configuration                 |
        | Remote session and client registry               |
        +-------------------------+------------------------+
                                  |
                         TideCode Client API
                                  |
                    +-------------+-------------+
                    |                           |
             Electron transport            Web transport
                  IPC                    HTTP + WebSocket
                    |                           |
              Desktop React                Browser React
                    |                     Desktop / Tablet /
                    |                         Mobile PWA
                    |
                   CLI
             shared local state
```

Later cloud path:

```text
Browser / PWA
     |
     v
console.tidecode.com
     |
     v
TideCode Relay
     ^
     | outbound secure connection
     |
TideCode Host on Laptop
```

The relay is a transport intermediary. It must not become the canonical owner of a user's local workspace or agent execution state.

## 5. Current Architecture Constraints to Address

The current codebase already provides strong foundations:

- React chat and workspace UI under `src/`.
- Shared chat stream events through `ChatStreamEventTarget`.
- Canonical local conversation persistence under TideCode history storage.
- Run-service state and active-run projections.
- A mature CLI that already reuses local TideCode state and runtime concepts.
- Terminal PTYs managed in Electron with output buffering and session metadata.

The main blockers for true remote parity are:

1. Renderer-facing APIs are exposed as Electron preload globals such as `window.tidecodeChat`, `window.tidecodeHistory`, `window.tidecodeTerminal`, `window.tidecodeWorkspace`, and `window.tidecodeGit`.
2. A normal browser cannot call Electron IPC.
3. Terminal sessions are currently associated with an Electron `WebContents` owner and terminal events are sent only to that owner.
4. Some UI state is renderer-local and must be classified as either local presentation state or shared host state.
5. The existing `electron/cli/remoteDaemon.ts` is a local HTTP/SSE prototype, not the final remote-workspace architecture.
6. There is no authenticated, versioned remote protocol covering the TideCode capabilities required by the shared React application.

## 6. Transport-Independent TideCode Client API

Introduce an application-facing client layer that the React UI uses instead of directly depending on Electron preload globals.

Conceptual shape:

```typescript
interface TideCodeClient {
  app: TideCodeAppClient
  chat: TideCodeChatClient
  runs: TideCodeRunsClient
  history: TideCodeHistoryClient
  settings: TideCodeSettingsClient
  providers: TideCodeProvidersClient
  models: TideCodeModelsClient
  workspace: TideCodeWorkspaceClient
  terminal: TideCodeTerminalClient
  git: TideCodeGitClient
  mcp: TideCodeMcpClient
  skills: TideCodeSkillsClient
}
```

Implementations:

- `ElectronTideCodeClient`: delegates to the existing preload APIs and IPC.
- `WebTideCodeClient`: communicates with the TideCode host through the remote protocol.

The objective is not to rewrite every backend service. The objective is to make the React application transport-agnostic at its boundary.

### Acceptance criteria

- React feature code no longer needs to know whether it is running in Electron or a browser for remote-capable operations.
- Existing desktop behavior remains functionally unchanged.
- API contracts are shared TypeScript types rather than manually duplicated request and response shapes.

## 7. Remote Protocol

Define one versioned protocol shared by the host and web client.

### 6.1 Connection model

Use HTTP for bootstrap/static resources and request-response operations where appropriate, and WebSocket for live bidirectional state and streaming.

Initial LAN endpoint:

```text
http://<host-lan-ip>:<configured-port>
```

The server is started only when Remote Access is enabled or explicitly activated.

### 6.2 Protocol envelope

All WebSocket messages should use a stable envelope similar to:

```typescript
interface RemoteEnvelope<T = unknown> {
  protocolVersion: number
  id: string
  type: string
  timestamp: number
  payload: T
}
```

Request-response messages should support correlation IDs. Event messages should be distinguishable from commands and responses.

### 6.3 Required protocol domains

The LAN MVP must support:

- session bootstrap and authentication
- host/device status
- conversation list and conversation reads
- conversation creation and metadata updates
- prompt submission
- active run discovery
- live chat stream events
- cancellation
- pending steer/follow-up synchronization where supported by the desktop runtime
- tool approval request and decision flow where the existing runtime requires approval
- workspace identity and current project selection
- terminal session list/create/write/resize/close
- terminal output and exit events
- Git status/diff operations required by the current UI
- workspace/file reads required by the current UI
- settings required to render and operate the remote interface
- connection/reconnection and state resynchronization

Capabilities can be negotiated so unsupported desktop-only actions are clearly disabled rather than silently failing.

## 8. Canonical State and Synchronization Rules

### 7.1 Conversation state

The host is authoritative for conversation records.

When any client submits a prompt:

1. The host accepts the action against a conversation ID.
2. The canonical conversation/run services process it.
3. The host broadcasts the resulting user-message and run events to all subscribed clients.
4. Stream events are delivered live to every client viewing or subscribed to that conversation.
5. Persisted conversation state remains compatible with the existing desktop and CLI history.

A remote-created conversation must appear in the desktop sidebar. A desktop-created conversation must be discoverable from the web client.

### 7.2 Active runs

Clients must be able to attach to an already-running turn after connection or reconnection. The web client must not require the turn to have been initiated by that same browser session.

### 7.3 Optimistic UI

Prefer host-confirmed canonical updates for cross-client state. Local optimistic presentation is acceptable only if it reconciles against host events and cannot produce duplicate messages or duplicate executions.

### 7.4 Presence and concurrency

The protocol should track connected devices and client IDs. Multiple clients may view the same conversation simultaneously.

For destructive or execution actions, the host remains the arbitration point. Request IDs and idempotency rules must prevent accidental duplicate execution after reconnect/retry.

## 9. Terminal Multiplexing

True terminal mirroring is a required feature, not an optional enhancement.

### Current issue

Terminal sessions currently have an `ownerWebContentsId`. Session creation, lookup, output delivery, and ownership checks assume one Electron window owns the PTY.

### Target model

```text
                    Terminal Session
                         PTY
                          |
              +-----------+-----------+
              |           |           |
          Desktop UI    Web UI      AI tools
          subscriber   subscriber    consumer
```

Refactor terminal ownership so that:

- the host owns the PTY lifecycle
- session identity is independent of a renderer connection
- authenticated clients subscribe to authorized workspace sessions
- output is broadcast to all subscribers
- input from an authorized subscriber is written to the same PTY
- reconnecting clients can obtain buffered/snapshot output and continue the session
- closing one UI does not automatically destroy a shared terminal unless lifecycle policy explicitly requires it

### Terminal acceptance criteria

- A terminal opened on desktop is visible on the phone for the same workspace.
- A terminal opened remotely can become visible on desktop without creating a second PTY.
- Typing `npm test` remotely executes on the laptop and its output is visible on both clients.
- Typing on desktop produces output visible on the remote terminal.
- Resize conflicts are handled predictably. One practical initial policy is that each viewer has its own render dimensions while the PTY uses the dimensions of the currently active writer or a stable host-selected size.

## 10. Web Application and UI Reuse

The web client should be built from the same React/TypeScript codebase as the Electron renderer.

### 9.1 Reuse strategy

Keep shared components, pages, hooks, message rendering, diff rendering, terminal view, settings presentation, and workspace UI in common packages/directories wherever practical.

Electron-only behavior must be isolated behind:

- the TideCode client transport
- environment/capability checks
- small platform adapters for operations that do not make sense in a browser

Do not fork the entire React application into a separate remote-only copy.

### 9.2 Responsive breakpoints

The UI must explicitly support:

- desktop
- tablet
- phone portrait
- phone landscape

Desktop retains the current multi-pane experience.

Tablet may collapse secondary panels into tabs or drawers.

Phone uses a mobile navigation model where chat remains primary and Files, Terminal, Diff/Git, and other major panels are presented as full-screen views, drawers, or bottom-navigation destinations rather than compressed desktop columns.

### 9.3 Mobile interaction requirements

- touch-friendly targets
- correct viewport and safe-area handling
- software-keyboard-safe composer behavior
- no horizontal page overflow
- terminal usable with touch keyboard and common control-key affordances
- dialogs and approvals usable on narrow screens
- code/diff views scroll intentionally without breaking the app layout
- sidebar becomes drawer/sheet/navigation screen
- connection state and host identity remain visible but unobtrusive

### 9.4 PWA

After the LAN web client is stable, add PWA support so the same web application can be installed to the phone home screen. PWA support must reuse the existing web client and must not create a second mobile implementation.

## 11. LAN Remote Host

The first complete user-facing milestone is direct LAN access while TideCode Desktop is open.

### Host behavior

Current LAN host behavior:

- the Remote host runs while TideCode Desktop is open
- the port is configurable under **Settings → Remote**
- the page shows the preferred LAN URL and all detected reachable LAN/overlay addresses, including Tailscale/ZeroTier-style interfaces when present
- the page shows connected browser count and host errors/status
- browser authentication is optional and is configured with a username/password under **Settings → Remote**
- changing credentials invalidates existing browser sessions
- changing the port restarts the listener transactionally
- Remote management APIs are desktop-only and are not exposed through browser RPC
- there is no persistent floating Remote status badge

Localhost-only is insufficient for phone access. The host binds to a LAN-reachable interface while the desktop app is running. Users who enable web authentication must log in before the protected UI and WebSocket are available.

## 12. LAN Security Model

Do not rely on network location as authentication.

### Required controls

Current LAN phase:

1. Optional username/password authentication is browser-only and managed by the trusted desktop Settings UI.
2. Passwords are stored as one-way scrypt verifiers, never plaintext.
3. Successful login establishes an HttpOnly SameSite session cookie. Credentials are not placed in the URL or sent with every RPC.
4. When web auth is enabled, both protected HTTP UI access and WebSocket control require an authenticated session.
5. Credential changes invalidate existing sessions and disconnect affected browser clients.
6. Browser WebSocket use is constrained to the TideCode-served origin rather than wildcard CORS.
7. Protocol payloads are validated at the host boundary.
8. Login attempts are throttled.
9. Desktop and CLI bypass the web authentication gate by design.
10. Remote management APIs themselves remain desktop-only and are not remotely callable.

Future hardening still requires an explicit encrypted-LAN/TLS story, broader rate/message-size limits, and a documented threat model. Account/device pairing and revocation move to the future cloud/account phase unless product requirements change.

The current prototype behavior of permissive CORS, unauthenticated metadata, and a generic bearer-token prompt endpoint must not define the production LAN protocol.

### HTTP on LAN

Plain HTTP may be acceptable for an early developer-only proof of concept, but the product plan should not assume that LAN traffic is trustworthy. Before treating LAN remote mode as generally safe, evaluate an authenticated encrypted LAN transport strategy or clearly scope the security guarantees. The protocol and client abstractions must not depend on plaintext transport.

## 13. Existing Remote Prototype Migration

`electron/cli/remoteDaemon.ts` should not remain the architectural center of remote access.

Its current HTTP/SSE prompt endpoint may be removed, replaced, or reduced to compatibility glue after the new host service exists.

Target organization may resemble:

```text
electron/remote/
  protocol.ts
  protocolValidation.ts
  remoteHost.ts
  clientRegistry.ts
  authentication.ts
  pairing.ts
  conversationBridge.ts
  runBridge.ts
  terminalBridge.ts
  workspaceBridge.ts
  gitBridge.ts
  websocketServer.ts
```

Exact filenames are implementation details and may change after inspection. Responsibilities should remain separated even if the final module boundaries differ.

## 14. Cloud Relay and console.tidecode.com

Cloud access is Phase 2 of the product, after LAN mode proves the host/client architecture.

### Goals

- user opens `console.tidecode.com`
- authenticates to their TideCode account
- selects a paired online machine
- uses the same web client used for LAN mode
- the laptop maintains an outbound secure connection to TideCode infrastructure
- no inbound router port forwarding is required
- prompts and events traverse the relay but execute locally

### Relay architecture

```text
Web Client <-- secure connection --> TideCode Relay <-- outbound secure connection --> Laptop Host
```

The relay should route versioned protocol envelopes between authenticated endpoints and maintain connection/session metadata. It should not independently implement chat, Git, terminal, or workspace behavior.

### Security direction

Before production cloud release, define:

- account authentication
- machine identity
- device pairing and revocation
- relay authorization
- session expiration
- replay protection
- protocol version compatibility
- end-to-end encryption requirements and threat model
- audit events
- abuse and rate limiting
- lost-device and compromised-account recovery

E2EE should be evaluated explicitly rather than implied by TLS alone.

## 15. Technology Choices

### Initial implementation

- TypeScript
- Node.js in the existing Electron host
- React + TypeScript for desktop and web UI
- WebSocket for bidirectional live transport
- HTTP for static/bootstrap/request-response operations where useful
- existing terminal stack and node-pty on the laptop
- shared runtime and domain types

### Not planned initially

- Go remote daemon
- Rust remote daemon
- separate Swift application
- separate Kotlin application
- separate agent implementation for the cloud

Go or Rust can be reconsidered if TideCode later needs an always-running OS service independent of Electron, unusually low memory overhead, stronger native isolation, or relay-scale requirements that materially justify a second runtime.

## 16. Implementation Milestones

Tracking legend:

- [ ] not started
- [~] in progress
- [x] complete and verified
- [!] blocked or intentionally deferred

### Milestone 0: Architecture boundary and protocol inventory

- [x] Inventory renderer calls to Electron preload APIs used by the main TideCode workspace UI.
- [x] Classify remote-required APIs and keep Remote host management desktop-only.
- [!] A new aggregate `TideCodeClient` interface was intentionally deferred in favor of a browser compatibility layer that installs the existing typed `window.tidecode*` contracts before React boots.
- [x] Define protocol versioning, request correlation, event envelopes, validation, and structured errors for the LAN bridge.
- [x] Define canonical ownership rules: laptop host is authoritative; execution/state is shared while responsive presentation state remains per-client.
- [x] Add focused protocol/host/auth contract tests.

**Exit criteria:** A browser-capable client contract exists without changing desktop behavior, and the core protocol shape is covered by focused tests.

### Milestone 1: Shared React browser compatibility bridge

- [x] Reuse the existing typed preload API surface as the application contract for the LAN phase.
- [x] Install a browser-side compatibility layer before importing/rendering the React application.
- [x] Forward browser RPC through the authenticated/versioned Remote host into a validated desktop-renderer dispatcher.
- [x] Reuse the same React components instead of forking a remote-only frontend.
- [x] Preserve existing desktop chat, history, workspace, Git, and terminal behavior in the verified test/build suite.
- [x] Keep trusted Remote host management desktop-only rather than exposing it through browser fallbacks.

**Exit criteria:** The desktop application runs through the new client abstraction with no intended UX regression.

### Milestone 2: LAN host foundation and optional web authentication

- [x] Add a dedicated Remote host service independent of the old CLI HTTP/SSE daemon.
- [x] Serve the production React application from the running TideCode desktop host.
- [x] Add WebSocket RPC/event handling with same-origin enforcement.
- [x] Add optional username/password web authentication with scrypt verification and HttpOnly SameSite sessions.
- [x] Add transactional configurable-port restart behavior.
- [x] Display preferred and alternate detected LAN/overlay addresses plus the configured port.
- [x] Display connected browser count and host status/errors under **Settings → Remote**.
- [x] Add host-side protocol validation and structured errors.
- [!] QR/token pairing and per-device revocation were superseded for the current LAN phase by the user's username/password decision.
- [ ] Add an explicit user-facing enable/disable Remote host toggle if product requirements still call for one.

**Exit criteria:** An authenticated browser on the same LAN can connect to the running TideCode desktop host and retrieve basic host/session/conversation information without exposing an unauthenticated control surface.

### Milestone 3: Shared chat and live run synchronization

- [x] List and open canonical desktop/CLI conversations remotely.
- [x] Create conversations remotely.
- [x] Submit prompts into the canonical TideCode chat runtime through the same desktop API surface.
- [x] Forward canonical chat/run stream events to connected web clients.
- [x] Broadcast history invalidation so remote conversation mutations reconcile into the desktop UI without manual refresh.
- [x] Expose active-run discovery and existing cancellation/steer/follow-up APIs through the web compatibility surface.
- [x] Expose the existing tool-decision API through the web compatibility surface.
- [ ] Add a dedicated two-client active-run reconnect/idempotency E2E test before calling the original Milestone 3 exit criteria fully verified.

**Exit criteria:** Start a turn on phone, watch it stream on laptop, then start a turn on laptop and watch it stream on phone, both against the same conversation and history.

### Milestone 4: Shared terminal behavior for the LAN browser bridge

- [!] The deeper host-owned PTY refactor is deferred. The current LAN bridge intentionally routes browser terminal calls through the same Electron renderer owner used by the desktop UI.
- [x] Desktop and browser resolve the same deterministic workspace/session key and therefore attach to the same PTY rather than creating a second shell.
- [x] Forward terminal data/exit events to the web client.
- [x] Allow remote terminal input/write/resize through the shared terminal API.
- [x] Synchronize explicit terminal-tab close events browser ↔ desktop without treating terminal restart as tab removal.
- [x] Preserve existing buffered terminal/session behavior and AI terminal execution in the full test suite.
- [ ] Add a dedicated runtime E2E that types a command from browser and asserts the exact output appears in both browser and desktop views.
- [ ] Revisit host-owned multi-subscriber PTY ownership before an architecture where the desktop renderer is no longer the bridge.

**Exit criteria:** One real laptop PTY can be viewed and controlled from desktop and phone, with output visible on both clients and no duplicate terminal process.

### Milestone 5: Web parity for core workspace capabilities

- [ ] Remote workspace/file browsing required by the existing UI.
- [ ] Remote file reads and safe supported writes/actions.
- [ ] Git status and diff views.
- [ ] Source-control actions selected for the first remote release.
- [ ] Relevant settings and model/provider display.
- [ ] MCP/skills state required by the chat experience.
- [ ] Capability gating for features not yet safe or implemented remotely.
- [ ] Verify that AI context still comes entirely from the laptop host.

**Exit criteria:** The web client supports the core daily TideCode workflow, not just prompt submission.

### Milestone 6: Responsive and mobile UI

- [x] Establish an explicit phone breakpoint at 767px and mobile workspace state rather than compressing the desktop shell.
- [x] Convert the main sidebar and Settings navigation to full-screen mobile surfaces.
- [x] Remove desktop-only panel controls and secondary workspace panes from the persistent phone UI.
- [x] Add the agreed persistent bottom navigation: **Chat / Terminal / Board**.
- [x] Make Terminal and Board full mobile surfaces while keeping their shared host state intact.
- [x] Keep Provider/Codex/Model/MCP/Skill/New Thread/Board task actions as mobile-safe dialogs where they are conceptually dialogs.
- [x] Use `100dvh` and safe-area-aware bottom padding in the mobile shell.
- [x] Verify phone portrait at 390 × 844 in real Chromium with no document/visible-element horizontal overflow across 21 checkpoints, including real Board task create/details.
- [x] Ensure desktop-only workspace controls are absent from the phone viewport.
- [x] Preserve desktop behavior under the full typecheck/test/build verification.
- [ ] Validate software-keyboard behavior on physical iOS and Android devices.
- [ ] Validate phone landscape.
- [ ] Validate tablet breakpoints.
- [ ] Add dedicated narrow diff/code-content tests if those contextual surfaces become primary mobile workflows.

**Exit criteria:** A phone can perform a complete remote TideCode workflow without switching to desktop-site mode or fighting a compressed desktop layout.

### Milestone 7: LAN product hardening

- [!] QR/token pairing and paired-device management are not part of the current username/password LAN design.
- [x] Add authenticated-host integration coverage for login gating, wrong-password rejection, session cookie establishment, authenticated WebSocket readiness, and port migration/session invalidation.
- [x] Add mobile Chromium UI smoke coverage for the shared web application at 390 × 844.
- [x] Add protocol/auth unit tests and same-origin WebSocket enforcement.
- [ ] Add reconnect/backoff and explicit offline UX coverage.
- [ ] Add broader rate/message-size limits and security tests.
- [ ] Complete a formal unauthenticated-endpoint/metadata audit.
- [ ] Add LAN threat-model documentation.
- [ ] Decide and implement the encryption/TLS story required for a supported LAN release.
- [ ] Add integration tests covering two simultaneous browser clients.
- [ ] Add a dedicated E2E for bidirectional chat-stream and terminal-output synchronization.

**Exit criteria:** LAN Remote Access is suitable for normal user testing with documented security properties and reliable reconnect behavior.

### Milestone 8: PWA

- [ ] Add web app manifest and installability.
- [ ] Add appropriate icons and mobile metadata.
- [ ] Define safe caching strategy that cannot serve protocol-incompatible or sensitive stale state incorrectly.
- [ ] Verify home-screen launch and authenticated reconnect behavior.
- [ ] Evaluate web push only if it is useful for approvals or completed-run notifications.

**Exit criteria:** The LAN/web TideCode client can be installed to a phone home screen and behaves like an app shell around the same shared web client.

### Milestone 9: Cloud relay and console.tidecode.com

- [ ] Define account and machine identity model.
- [ ] Implement laptop outbound relay connection.
- [ ] Implement relay routing for the existing remote protocol.
- [ ] Host the same web application at `console.tidecode.com`.
- [ ] Add machine presence and online/offline selection.
- [ ] Add secure account/device pairing and revocation.
- [ ] Add reconnect, session migration, and relay observability.
- [ ] Define and implement E2EE requirements if selected by the threat model.
- [ ] Verify that relay infrastructure cannot execute TideCode workspace actions independently of the connected host.

**Exit criteria:** A user away from their LAN can open `console.tidecode.com`, select their online laptop, and use the same TideCode web experience through the relay.

## 17. Testing Strategy

### Unit tests

- protocol encoding/decoding
- validation and version handling
- authentication/session logic
- permission/capability checks
- request correlation and idempotency
- client adapters
- synchronization reducers/state machines
- terminal subscriber/lifecycle rules

### Integration tests

- desktop host plus simulated web client
- multiple concurrent web clients
- prompt start and stream fan-out
- desktop-started run observed remotely
- remote-started run observed by desktop
- reconnect during stream
- cancellation
- approval flow
- terminal create/attach/input/output/exit
- pairing/revocation

### UI tests

- desktop regression at existing viewport sizes
- tablet breakpoint
- phone portrait
- phone landscape
- software keyboard interaction
- narrow diff/code rendering
- terminal touch input

### Verification before each completed milestone

Use the repository's standard verification commands as applicable, including:

```text
npm run typecheck
npm test
npm run build
```

Focused tests should run during development before the full suite.

## 18. Security Review Checklist

Before declaring LAN or cloud remote access production-ready, verify:

- [~] When web auth is enabled, protected UI and WebSocket control are gated by the authenticated session. Auth-disabled LAN mode intentionally remains accessible to reachable LAN clients.
- [!] Pairing secrets are superseded by optional username/password for the current LAN phase.
- [!] Per-device revocation is deferred with the pairing model; credential changes invalidate all current web sessions.
- [x] Web credentials are not placed in URLs, and stored passwords use one-way verifiers rather than plaintext.
- [x] WebSocket authentication is enforced before command handling when web auth is enabled.
- [ ] Every state-changing command is authorized server-side.
- [ ] Payload validation rejects malformed and oversized messages.
- [ ] Retry/reconnect cannot duplicate destructive actions.
- [ ] Browser origin/cross-site request risks are addressed.
- [ ] Terminal access is scoped to authenticated authorized sessions/workspaces.
- [ ] File path validation prevents escaping authorized workspace semantics.
- [ ] Cloud relay threat model explicitly covers relay compromise, account compromise, stolen device, and replay.

## 19. Non-Goals for the LAN MVP

The first LAN milestone does not require:

- a native iOS application
- a native Android application
- a Rust or Go daemon
- remote access while the TideCode desktop host is fully closed
- production cloud relay infrastructure
- push notifications
- every secondary settings/admin screen
- screen sharing or arbitrary remote desktop control

The goal is TideCode workspace control and synchronization, not generic OS remote desktop software.

## 20. Definition of Done for the Overall Remote Workspace Project

The project is considered complete when:

1. TideCode Desktop can act as an authenticated host while open.
2. The same React application is usable in Electron and a browser through transport adapters.
3. Desktop, web, and CLI operate on the same canonical conversations and local runtime state.
4. A running chat turn is visible and controllable from another connected client in real time.
5. Terminal sessions are truly shared host resources and can be mirrored between laptop and phone.
6. Core files/Git/workspace capabilities needed for daily TideCode use work remotely.
7. The web UI is intentionally responsive and usable on phones and tablets.
8. LAN access is secure enough for its documented supported threat model.
9. The same web client can be installed as a PWA.
10. The architecture supports, and eventually implements, remote access through `console.tidecode.com` using an outbound laptop connection and relay without duplicating the TideCode runtime.

## 21. Tracking Rules

This file is the canonical implementation tracker for Remote Workspace work.

- Update checklist items only when implementation evidence supports the status.
- Mark a milestone complete only after its exit criteria are verified.
- Record material architectural deviations in this plan instead of allowing code and plan to silently diverge.
- Keep the old docs/plan/plan-003.md as historical context unless a separate cleanup task explicitly removes or archives it.
- Do not reopen completed CLI implementation work unless Remote Workspace integration exposes a concrete compatibility defect.
- Prefer completing one vertical slice with tests before broadening capability coverage.

## 22. Recommended First Implementation Slice

The first implementation slice should be Milestones 0 through the smallest useful portion of Milestone 2:

1. Define the TideCode client abstraction and protocol core.
2. Keep desktop behavior running through an Electron adapter.
3. Add a minimal authenticated LAN host and browser bootstrap.
4. Connect a browser client and prove read-only conversation discovery.
5. Then add one canonical prompt/stream vertical slice before expanding into terminal or Git.

That sequence validates the central architecture early while avoiding a second agent implementation or a throwaway remote-only UI.
