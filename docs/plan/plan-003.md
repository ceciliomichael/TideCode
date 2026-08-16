# Plan 003: Bundled CLI Distribution and Mobile Remote Control Relay

Status: proposed

This plan establishes the architecture and implementation roadmap for:
1. **Bundled CLI Distribution:** Providing a first-class terminal agent (`tidecode`) and headless automation runner (`tidecode -p`) bundled directly inside the desktop installer (`TideCode-Windows-Setup.exe`, `TideCode.AppImage`, `TideCode.dmg`).
2. **Core Engine Reusability:** Reusing the canonical agent loop (`runToolEnabledChatStream`) and local storage (`~/.tidecode/history/`) across both Desktop GUI and CLI with zero divergence.
3. **Mobile Remote Control Relay:** Providing an outbound-only daemon (`tidecode remote`) allowing developers to steer long-running agent tasks, stream diffs, and approve tool executions from a mobile companion client.

---

## 1. Decision Summary

- **Single Codebase & Shared Binaries:** Do not create a separate repository. The CLI and Desktop application live in the same repository, share the exact same model client adapters, prompt caching policies, tool execution bundles, and test suites.
- **Zero Extra Dependencies for End Users:** Leverage Electron's embedded Node.js runtime using `ELECTRON_RUN_AS_NODE=1`. Users do not need Node.js installed to run the `tidecode` command in their terminal.
- **Installer-Driven PATH Registration:** The Windows NSIS installer (`installer/installer.nsh`) will automatically add `$INSTDIR\bin` to the user's `PATH`. macOS and Linux installers will link the binary to `/usr/local/bin` or `~/.local/bin`.
- **Event Sink Abstraction:** Decouple `webContents` from `runToolEnabledChatStream` and replace it with a universal `ChatEventSink`. The same engine outputs to Electron IPC, Terminal stdout, or WebSocket streaming without code duplication.
- **Shared History & State:** All conversation records, checkpoints, skills, and configuration files continue to live under `~/.tidecode/`. A conversation started in the CLI can be resumed seamlessly in the Desktop GUI.
- **Interactive TUI Controls:** Slash commands (`/`) and file autocompletion (`@`) operate within the interactive TUI REPL to steer sessions and attach context dynamically.
- **Outbound-Only Remote Relay:** Remote mobile control operates over an outbound-only TLS WebSocket connection to avoid requiring inbound port forwarding, dynamic DNS, or firewall exceptions.

---

## 2. System Architecture

```text
                               ┌──────────────────────────────────────────────┐
                               │           TideCode Core Engine               │
                               │      (electron/chat/shared/runtime.ts)       │
                               │                                              │
                               │  - Model Providers (@ai-sdk, Codex)          │
                               │  - Agent Loop & Code Mode Executor           │
                               │  - Tool Bundle (Ripgrep, Edit, node-pty)     │
                               │  - Context Compaction & Checkpoints          │
                               │  - Event Store (~/.tidecode/history/)        │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                           [ChatEventSink Interface]
                                                      │
               ┌──────────────────────────────────────┼──────────────────────────────────────┐
               ▼                                      ▼                                      ▼
    ┌──────────────────────┐               ┌──────────────────────┐               ┌──────────────────────┐
    │     Desktop GUI      │               │     Terminal CLI     │               │     Remote Relay     │
    │  (Electron Renderer) │               │   (Interactive/TUI)  │               │   (Mobile Daemon)    │
    │                      │               │                      │               │                      │
    │ - React + Monaco     │               │ - Ink / Clack TUI    │               │ - Outbound WebSocket │
    │ - IPC Event Bridge   │               │ - @ Mentions & / Cmds│               │ - E2EE Token Auth    │
    │ - Visual Kanban & Git│               │ - Headless (-p mode) │               │ - Mobile Push Alerts │
    └──────────────────────┘               └──────────────────────┘               └──────────────────────┘
```

---

## 3. Core Engine Abstraction (`ChatEventSink`)

### 3.1 Current State
In the current desktop implementation:
```typescript
// electron/chat/shared/runtimeStreamEvents.ts
export function emitChatStreamEvent(webContents: WebContents, payload: ChatStreamEvent) {
  if (webContents.isDestroyed()) return
  webContents.send('chat:stream:event', payload)
}
```

### 3.2 Target State
Abstract the communication channel into an event sink contract:

```typescript
// electron/chat/shared/eventSink.ts
export interface ChatEventSink {
  emit(event: ChatStreamEvent): void
  requestToolApproval?(toolCall: ToolApprovalRequest): Promise<ToolApprovalDecision>
  isAborted?(): boolean
}
```

`runToolEnabledChatStream` accepts `sink: ChatEventSink` instead of `webContents: WebContents`:
1. **Desktop Adapter:**
   ```typescript
   export const createWebContentsSink = (webContents: WebContents): ChatEventSink => ({
     emit: (event) => {
       if (!webContents.isDestroyed()) webContents.send('chat:stream:event', event)
     }
   })
   ```
2. **Terminal Adapter:**
   ```typescript
   export const createTerminalSink = (stdout: NodeJS.WriteStream): ChatEventSink => ({
     emit: (event) => {
       if (event.type === 'text-delta') stdout.write(event.delta)
       if (event.type === 'tool-call') renderTerminalToolCard(event)
       if (event.type === 'tool-result') renderTerminalDiff(event)
     }
   })
   ```
3. **Remote Relay Adapter:**
   ```typescript
   export const createRemoteRelaySink = (ws: WebSocket): ChatEventSink => ({
     emit: (event) => {
       if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
     }
   })
   ```

---

## 4. CLI Execution & Distribution Model

### 4.1 Directory Layout Post-Install
When installed on Windows via NSIS:

```text
%LOCALAPPDATA%\Programs\TideCode\
├── TideCode.exe                         <-- Electron executable
├── resources/
│   ├── app.asar                         <-- Bundled dist + dist-electron
│   └── ripgrep/                         <-- Bundled ripgrep binary
└── bin/
    ├── tidecode                         <-- Shell script (Git Bash / WSL / macOS)
    └── tidecode.cmd                     <-- Batch script (CMD / PowerShell)
```

### 4.2 Windows Wrapper Script (`bin/tidecode.cmd`)
```cmd
@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0\..\TideCode.exe" "%~dp0\..\resources\app.asar\dist-electron\cli.js" %*
endlocal
```

### 4.3 Unix Wrapper Script (`bin/tidecode`)
```bash
#!/usr/bin/env sh
ELECTRON_RUN_AS_NODE=1 exec "$SCRIPT_DIR/../TideCode" "$SCRIPT_DIR/../resources/app.asar/dist-electron/cli.js" "$@"
```

### 4.4 Installer PATH Registration (`installer/installer.nsh`)
```nsis
!macro customInstall
  ; Register bin directory in User PATH environment variable
  EnVar::AddValue "PATH" "$INSTDIR\bin"
!macroend

!macro customUnInstall
  ; Remove bin directory from User PATH on uninstallation
  EnVar::DeleteValue "PATH" "$INSTDIR\bin"
!macroend
```

---

## 5. CLI Capabilities, TUI Commands, and Mentions

### 5.1 Interactive REPL (`tidecode`)
- **TUI Interface:** Terminal layout with conversation history, active model badge, context token usage, and live progress spinners.
- **Inline Diff Review:** Colorized unified diffs before file modifications are applied to disk.
- **Interactive Approvals:** `[Y] Yes  [N] No  [A] Always allow in this session` prompts for shell execution and sensitive file edits.

### 5.2 Slash Commands in Interactive TUI (`/`)
In interactive TUI mode, typing `/` invokes the terminal command router without dispatching text to the LLM.

```text
> /
  ╭── Slash Commands ──────────────────────────────────────────────────────────╮
  │ › /model [name]   Switch active model (Claude, GPT-4o, Gemini, DeepSeek)   │
  │   /mode [agent|plan] Switch between execution agent and read-only plan mode│
  │   /resume         Browse and resume past sessions (with project origin)    │
  │   /compact        Trigger manual context compaction (Plan 001)             │
  │   /undo           Revert file changes made in the last turn (Checkpoints)  │
  │   /diff           View colorized unified diff of uncommitted workspace work│
  │   /mcp            List and inspect active MCP tools and servers            │
  │   /skills         List and toggle workspace skills                         │
  │   /remote         Start mobile companion pairing daemon                    │
  │   /clear          Reset current conversation turn                          │
  │   /help           Display shortcut help and command reference              │
  ╰────────────────────────────────────────────────────────────────────────────╯
```

*(Note: In headless mode `tidecode -p`, slash commands are not used interactively; equivalent settings are passed via CLI flags like `--model <id>`, `--mode <agent|plan>`, and `--compact`.)*

### 5.3 Context & File Mentions (`@`)
In interactive TUI mode, typing `@` activates a fuzzy autocompletion menu across the workspace index:

```text
> Please inspect @auth
  ╭── Matching Workspace Files ────────────────────────────────────────────────╮
  │ › src/middleware/auth.ts                                                   │
  │   src/types/auth.ts                                                        │
  │   tests/auth.test.ts                                                       │
  │   docs/authentication.md                                                   │
  ╰────────────────────────────────────────────────────────────────────────────╯
```

#### Supported Mention Syntax:
| Syntax | Scope & Action |
| :--- | :--- |
| `@path/to/file.ts` | Resolves and pins the specified file directly into prompt context. |
| `@path/to/file.ts:25-60` | Extracts and pins only lines 25 to 60 (token-efficient context). |
| `@dir/` | Injects directory tree hierarchy so the model understands folder structure. |
| `@git` / `@diff` | Injects uncommitted workspace diffs. |
| `@staged` | Injects only staged git diff (`git diff --cached`). |
| `@problems` | Injects current compile/linter errors from the workspace. |

*(Note: In headless `-p` mode, `@file` mentions in the prompt string are statically parsed and expanded before model invocation, without the interactive autocomplete dropdown.)*

### 5.4 Headless / One-Shot Mode (`tidecode -p`)
Allows direct scripting and piping:
```bash
# Execute prompt directly
tidecode -p "Refactor auth middleware to use JWT"

# Pipe errors from compiler into TideCode
npm run typecheck 2>&1 | tidecode -p "Fix these TypeScript errors"
```

### 5.5 Session Resumption (`/resume`)
Seamless continuity between CLI and Desktop:

```text
> /resume
  ╭── Recent Conversations (Select to Resume) ─────────────────────────────────╮
  │ › [project: tidecode] "Refactor auth middleware to use JWT" (25m ago)      │
  │   [project: api-gateway] "Fix CORS preflight headers" (2h ago)             │
  │   [project: web-client] "Add dark mode toggle to navigation" (Yesterday)  │
  ╰────────────────────────────────────────────────────────────────────────────╯
```

CLI flag alternative for headless or quick launch:
```bash
# Resume a specific conversation ID directly
tidecode --continue <conversation-id>
```

---

## 6. Mobile Remote Control Relay Protocol

### 6.1 Overview
The remote control mode eliminates **"agent stall"** when developers are away from their workstation by routing prompts, token streams, and approval modals to a mobile device.

```text
┌─────────────────┐             ┌─────────────────────┐             ┌─────────────────────┐
│  Mobile Client  │ ──(TLS)───► │  Cloud Relay Server │ ◄───(TLS)── │   TideCode Daemon   │
│ (PWA / App / TG)│             │ (No Inbound Ports)  │             │  (Local Workstation)│
└─────────────────┘             └─────────────────────┘             └─────────────────────┘
```

### 6.2 Protocol Flow
1. **Starting Remote Mode:**
   ```bash
   tidecode remote --pair
   # Generates QR code in terminal containing relay endpoint and single-use session key
   ```
2. **Outbound Connection:** The local workstation establishes an outbound WebSocket connection to the relay server. No inbound ports are opened on the local firewall.
3. **Session Pairing:** The mobile device scans the QR code or authenticates with the session token.
4. **Approval Dispatch:** When a dangerous tool (terminal execution, file overwrite) requires human confirmation:
   - Daemon dispatches `approval-required` event to relay.
   - Relay delivers notification to mobile client (APNs / FCM push or Web push).
   - User reviews diff/command on mobile and taps **Approve**.
   - Daemon receives approval payload and resumes local execution.

---

## 7. Implementation Milestones

| Milestone | Deliverables | Target Artifacts |
| :--- | :--- | :--- |
| **Phase 1: EventSink Abstraction** | Decouple `webContents` from `runtime.ts`, `runtimeStreamEvents.ts`, and tool bundles. | `electron/chat/shared/eventSink.ts` |
| **Phase 2: CLI Entry Point & TUI** | Build `electron/cli.ts` with interactive readline/Ink TUI, `@` mention parser, and `/` slash command router. | `dist-electron/cli.js`, `bin/tidecode.cmd` |
| **Phase 3: Installer & Packaging** | Update `installer.nsh` and `electron-builder.json5` to bundle `bin/` and configure `PATH`. | `installer/installer.nsh`, `electron-builder.json5` |
| **Phase 4: Remote Relay Daemon** | Implement `tidecode remote` subcommand, outbound WebSocket client, and pairing protocol. | `electron/remote/relayClient.ts` |
