import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { spawn, type IPty } from "node-pty";
import {
  assertWorkspaceDirectory,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from "../workspace/paths";
import { activateVenvInEnvironment, detectVenvInfo, findVenvPath } from "../python/venv";
import type {
  CloseTerminalSessionInput,
  CreateTerminalSessionInput,
  CreateTerminalSessionResult,
  TerminalSessionOutputInput,
  OpenExternalTerminalLinkInput,
  ResizeTerminalSessionInput,
  TerminalDataEvent,
  TerminalExitEvent,
  WriteTerminalSessionInput,
} from "../../src/types/chat";

const TERMINAL_MIN_COLS = 20;
const TERMINAL_MAX_COLS = 400;
const TERMINAL_MIN_ROWS = 6;
const TERMINAL_MAX_ROWS = 200;
const MAX_SESSION_OUTPUT_BUFFER_LENGTH = 300_000;
const MAX_TERMINAL_POLLING_MS = 60_000;
const IDLE_TERMINATE_MS = 5 * 60 * 1000; // 5 minutes
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

interface TerminalShellSpec {
  args: string[];
  command: string;
  label: string;
}

interface ActiveTerminalSession {
  cwd: string;
  enableIdleTimeout: boolean;
  exitCode: number | null;
  hasExited: boolean;
  idleTimerId: ReturnType<typeof setTimeout> | null;
  isAiSession: boolean;
  label: string | null;
  lastReadAt: number;
  outputBuffer: string;
  outputWaiters: Set<() => void>;
  ownerWebContentsId: number;
  ptyProcess: IPty;
  shellLabel: string;
  signal: number | null;
  venvName: string | null;
  workspaceRootPath: string;
  workspaceSessionKey: string;
}

export interface TerminalSessionSnapshot {
  cwd: string;
  exitCode: number | null;
  hasExited: boolean;
  label: string | null;
  outputBuffer: string;
  shellLabel: string;
  signal: number | null;
  sessionId: number;
}

export interface TerminalSessionInfo {
  cwd: string;
  hasExited: boolean;
  label: string | null;
  lastReadAt: number;
  sessionId: number;
  shellLabel: string;
  workspaceRootPath: string;
}

const sessions = new Map<number, ActiveTerminalSession>();
const ownerSessionIds = new Map<number, Set<number>>();
const ownerWorkspaceSessions = new Map<number, Map<string, number>>();
const ownersWithCleanup = new Set<number>();

let nextGlobalSessionId = 1;

function getNextSessionId() {
  return nextGlobalSessionId++;
}

function clampInteger(
  value: number,
  min: number,
  max: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const boundedValue = Math.floor(value);
  if (boundedValue < min) {
    return min;
  }

  if (boundedValue > max) {
    return max;
  }

  return boundedValue;
}

function assertDirectoryExists(directoryPath: string) {
  if (!existsSync(directoryPath)) {
    throw new Error(
      `Terminal working directory does not exist: ${directoryPath}`,
    );
  }

  if (!statSync(directoryPath).isDirectory()) {
    throw new Error(
      `Terminal working directory is not a directory: ${directoryPath}`,
    );
  }
}

function resolveTerminalWorkspaceRootPath(workspaceRootPath: string | null | undefined) {
  const normalizedWorkspaceRootPath = workspaceRootPath?.trim() ?? "";
  if (normalizedWorkspaceRootPath.length === 0) {
    return null;
  }

  return normalizeWorkspacePath(normalizedWorkspaceRootPath);
}

async function assertTerminalWorkspaceDirectory(workspaceRootPath: string | null) {
  if (!workspaceRootPath) {
    return;
  }

  await assertWorkspaceDirectory(workspaceRootPath);
}

function resolveTerminalCwd(
  workspaceRootPath: string | null,
  cwd: string | null | undefined,
) {
  const normalizedCwd = cwd?.trim() ?? "";
  if (workspaceRootPath) {
    try {
      const targetPath = getSafeWorkspaceTargetPath(
        workspaceRootPath,
        normalizedCwd.length > 0 ? normalizedCwd : ".",
      );
      assertDirectoryExists(targetPath.absolutePath);
      return targetPath.absolutePath;
    } catch (error) {
      if (normalizedCwd.length > 0) {
        const resolvedPath = path.resolve(normalizedCwd);
        if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
          return resolvedPath;
        }
      }
      throw error;
    }
  }

  if (normalizedCwd.length === 0) {
    return process.cwd();
  }

  const resolvedPath = path.resolve(normalizedCwd);
  assertDirectoryExists(resolvedPath);
  return resolvedPath;
}

function resolveUnixShellSpecs() {
  const fromEnvironment = process.env.SHELL?.trim();
  const shells = [fromEnvironment, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    (value): value is string => {
      return typeof value === "string" && value.length > 0;
    },
  );

  return shells.map(
    (shellPath): TerminalShellSpec => ({
      args: ["-l"],
      command: shellPath,
      label: path.basename(shellPath),
    }),
  );
}

function resolveWindowsShellSpecs() {
  const windowsDirectory = process.env.WINDIR?.trim() || "C:\\Windows";
  const programFilesDirectory =
    process.env.ProgramFiles?.trim() || "C:\\Program Files";
  const comSpec = process.env.ComSpec?.trim();
  const windowsPowerShellPath = path.join(
    windowsDirectory,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const pwshPath = path.join(
    programFilesDirectory,
    "PowerShell",
    "7",
    "pwsh.exe",
  );
  const windowsCandidates: TerminalShellSpec[] = [];
  const interactivePowerShellArgs = createPowerShellInteractiveArgs();

  if (existsSync(pwshPath)) {
    windowsCandidates.push({
      args: interactivePowerShellArgs,
      command: pwshPath,
      label: "PowerShell 7",
    });
  }

  windowsCandidates.push({
    args: interactivePowerShellArgs,
    command: "pwsh.exe",
    label: "PowerShell 7",
  });

  if (existsSync(windowsPowerShellPath)) {
    windowsCandidates.push({
      args: interactivePowerShellArgs,
      command: windowsPowerShellPath,
      label: "PowerShell",
    });
  }

  windowsCandidates.push({
    args: interactivePowerShellArgs,
    command: "powershell.exe",
    label: "PowerShell",
  });

  if (comSpec && comSpec.length > 0) {
    windowsCandidates.push({
      args: [],
      command: comSpec,
      label: "Command Prompt",
    });
  } else {
    windowsCandidates.push({
      args: [],
      command: "cmd.exe",
      label: "Command Prompt",
    });
  }

  return windowsCandidates;
}

function createTerminalEnvironment(cwd: string, workspaceRootPath: string | null) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PYTHONUNBUFFERED: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  const venvPath = findVenvPath(cwd, workspaceRootPath);
  if (venvPath) {
    return activateVenvInEnvironment(environment, venvPath);
  }

  return environment;
}


function createPowerShellInteractiveArgs() {
  return [
    "-NoLogo",
    "-NoExit",
    "-Command",
    [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "if ($env:VIRTUAL_ENV) { $vName = Split-Path $env:VIRTUAL_ENV -Leaf; function prompt { \"($vName) \" + (Get-Location) + '> ' } }",
      "if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine -ErrorAction SilentlyContinue }",
      "if (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) {",
      "  try { Set-PSReadLineOption -PredictionSource History -PredictionView InlineView -BellStyle None } catch {}",
      "}",
    ].join("; "),
  ];
}

function parseExternalTerminalLink(rawUrl: string) {
  const normalizedUrl = rawUrl.trim();
  if (normalizedUrl.length === 0) {
    throw new Error("A URL is required.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch (_error) {
    throw new Error("Only absolute URLs are supported.");
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  return parsedUrl.toString();
}

function resolveShellSpecs() {
  return process.platform === "win32"
    ? resolveWindowsShellSpecs()
    : resolveUnixShellSpecs();
}

function toWorkspaceKey(cwd: string) {
  const normalized = path.normalize(cwd);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function toWorkspaceSessionKey(
  workspaceKey: string,
  sessionKey?: string | null,
) {
  const normalizedSessionKey = sessionKey?.trim() ?? "";
  return normalizedSessionKey.length > 0
    ? `${workspaceKey}::${normalizedSessionKey}`
    : workspaceKey;
}

function appendSessionOutputBuffer(
  activeSession: ActiveTerminalSession,
  chunk: string,
) {
  activeSession.outputBuffer += chunk;

  // If the output contains ANSI clear scrollback (\x1b[3J) or reset (\x1b[c) sequences,
  // slice the buffer from the last occurrence so re-attaching or reusing this session
  // does not re-emit cleared historical output or undo the user's clear command.
  const clearScrollbackIdx = activeSession.outputBuffer.lastIndexOf("\x1b[3J");
  const resetIdx = activeSession.outputBuffer.lastIndexOf("\x1b[c");
  const lastClearIdx = Math.max(clearScrollbackIdx, resetIdx);

  if (lastClearIdx !== -1) {
    activeSession.outputBuffer = activeSession.outputBuffer.slice(lastClearIdx);
  } else if (activeSession.outputBuffer.length > MAX_SESSION_OUTPUT_BUFFER_LENGTH) {
    const startIndex =
      activeSession.outputBuffer.length - MAX_SESSION_OUTPUT_BUFFER_LENGTH;
    activeSession.outputBuffer = activeSession.outputBuffer.slice(startIndex);
  }
}

function createTerminalSessionSnapshot(
  sessionId: number,
  activeSession: ActiveTerminalSession,
): TerminalSessionSnapshot {
  return {
    cwd: activeSession.cwd,
    exitCode: activeSession.exitCode,
    hasExited: activeSession.hasExited,
    label: activeSession.label,
    outputBuffer: activeSession.outputBuffer,
    shellLabel: activeSession.shellLabel,
    signal: activeSession.signal,
    sessionId,
  };
}

function notifySessionWaiters(activeSession: ActiveTerminalSession) {
  const waiters = Array.from(activeSession.outputWaiters.values());
  activeSession.outputWaiters.clear();
  for (const resolve of waiters) {
    resolve();
  }
}

function registerSessionWithOwner(
  ownerWebContentsId: number,
  sessionId: number,
) {
  const activeOwnerSessions = ownerSessionIds.get(ownerWebContentsId);
  if (activeOwnerSessions) {
    activeOwnerSessions.add(sessionId);
    return;
  }

  ownerSessionIds.set(ownerWebContentsId, new Set([sessionId]));
}

function unregisterSessionFromOwner(
  ownerWebContentsId: number,
  sessionId: number,
) {
  const activeOwnerSessions = ownerSessionIds.get(ownerWebContentsId);
  if (!activeOwnerSessions) {
    return;
  }

  activeOwnerSessions.delete(sessionId);
  if (activeOwnerSessions.size === 0) {
    ownerSessionIds.delete(ownerWebContentsId);
  }
}

function registerWorkspaceSession(
  ownerWebContentsId: number,
  workspaceKey: string,
  sessionId: number,
) {
  const ownerMappings = ownerWorkspaceSessions.get(ownerWebContentsId);
  if (ownerMappings) {
    ownerMappings.set(workspaceKey, sessionId);
    return;
  }

  ownerWorkspaceSessions.set(
    ownerWebContentsId,
    new Map([[workspaceKey, sessionId]]),
  );
}

function unregisterWorkspaceSession(
  ownerWebContentsId: number,
  workspaceKey: string,
  sessionId: number,
) {
  const ownerMappings = ownerWorkspaceSessions.get(ownerWebContentsId);
  if (!ownerMappings) {
    return;
  }

  const mappedSessionId = ownerMappings.get(workspaceKey);
  if (mappedSessionId === sessionId) {
    ownerMappings.delete(workspaceKey);
  }
  if (ownerMappings.size === 0) {
    ownerWorkspaceSessions.delete(ownerWebContentsId);
  }
}

function findWorkspaceSessionId(
  ownerWebContentsId: number,
  workspaceKey: string,
) {
  const ownerMappings = ownerWorkspaceSessions.get(ownerWebContentsId);
  return ownerMappings?.get(workspaceKey) ?? null;
}

function terminateSession(sessionId: number) {
  const activeSession = sessions.get(sessionId);
  if (!activeSession) {
    return;
  }

  if (activeSession.idleTimerId !== null) {
    clearTimeout(activeSession.idleTimerId);
    activeSession.idleTimerId = null;
  }

  notifySessionWaiters(activeSession);
  sessions.delete(sessionId);
  unregisterSessionFromOwner(activeSession.ownerWebContentsId, sessionId);
  unregisterWorkspaceSession(
    activeSession.ownerWebContentsId,
    activeSession.workspaceSessionKey,
    sessionId,
  );



function killPtyProcessTree(ptyProcess: IPty) {
  try {
    const pid = ptyProcess.pid;
    if (process.platform === "win32" && typeof pid === "number" && pid > 0) {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      ptyProcess.kill();
    }
  } catch (error) {
    try {
      ptyProcess.kill();
    } catch {
      // ignore
    }
  }
}

  killPtyProcessTree(activeSession.ptyProcess);
}

function scheduleIdleTerminate(sessionId: number) {
  const activeSession = sessions.get(sessionId);
  if (!activeSession || !activeSession.enableIdleTimeout) return;

  if (activeSession.idleTimerId !== null) {
    clearTimeout(activeSession.idleTimerId);
  }

  activeSession.idleTimerId = setTimeout(() => {
    const session = sessions.get(sessionId);
    if (!session || !session.enableIdleTimeout) return;
    const idleMs = Date.now() - session.lastReadAt;
    if (idleMs >= IDLE_TERMINATE_MS) {
      terminateSession(sessionId);
    }
  }, IDLE_TERMINATE_MS);
}

function terminateSessionsForOwner(ownerWebContentsId: number) {
  const activeOwnerSessions = ownerSessionIds.get(ownerWebContentsId);
  if (!activeOwnerSessions) {
    return;
  }

  const sessionIds = Array.from(activeOwnerSessions.values());
  for (const sessionId of sessionIds) {
    terminateSession(sessionId);
  }

  ownerSessionIds.delete(ownerWebContentsId);
  ownerWorkspaceSessions.delete(ownerWebContentsId);
}

function attachOwnerCleanup(sender: WebContents) {
  if (ownersWithCleanup.has(sender.id)) {
    return;
  }

  ownersWithCleanup.add(sender.id);
  sender.once("destroyed", () => {
    ownersWithCleanup.delete(sender.id);
    terminateSessionsForOwner(sender.id);
  });
}

function assertSessionOwnership(
  ownerWebContentsId: number,
  sessionId: number,
  workspaceRootPath?: string | null,
) {
  const activeSession = sessions.get(sessionId);
  if (!activeSession) {
    throw new Error(`Unknown terminal session id: ${sessionId}`);
  }

  if (activeSession.ownerWebContentsId !== ownerWebContentsId) {
    throw new Error(
      `Terminal session ${sessionId} does not belong to this window.`,
    );
  }

  const normalizedWorkspaceRootPath = workspaceRootPath?.trim()
    ? normalizeWorkspacePath(workspaceRootPath)
    : null;
  if (
    normalizedWorkspaceRootPath &&
    activeSession.workspaceRootPath !== normalizedWorkspaceRootPath
  ) {
    throw new Error(
      `Terminal session ${sessionId} does not belong to workspace ${normalizedWorkspaceRootPath}.`,
    );
  }

  return activeSession;
}

function assertSessionOwnershipForRead(
  ownerWebContentsId: number,
  sessionId: number,
  workspaceRootPath?: string | null,
) {
  return assertSessionOwnership(ownerWebContentsId, sessionId, workspaceRootPath);
}

function clampTerminalPollingMs(pollingMs: number | undefined) {
  return clampInteger(pollingMs ?? 0, 0, MAX_TERMINAL_POLLING_MS, 0);
}

function waitForTerminalSessionExitOrTimeout(
  activeSession: ActiveTerminalSession,
  pollingMs: number,
) {
  if (pollingMs <= 0 || activeSession.hasExited) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const wrappedResolve = () => {
      clearTimeout(timeoutId);
      activeSession.outputWaiters.delete(wrappedResolve);
      resolve();
    };

    const timeoutId = setTimeout(() => {
      activeSession.outputWaiters.delete(wrappedResolve);
      resolve();
    }, pollingMs);

    activeSession.outputWaiters.add(wrappedResolve);
  });
}

function spawnTerminalFromCandidates(input: {
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  rows: number;
}) {
  const shellSpecs = resolveShellSpecs();
  const spawnErrors: string[] = [];

  for (const shellSpec of shellSpecs) {
    try {
      const ptyProcess = spawn(shellSpec.command, shellSpec.args, {
        cols: input.cols,
        cwd: input.cwd,
        env: input.env,
        name: "xterm-256color",
        rows: input.rows,
      });

      return {
        ptyProcess,
        shellLabel: shellSpec.label,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spawnErrors.push(`${shellSpec.command}: ${message}`);
    }
  }

  throw new Error(
    `Failed to start terminal shell. Attempts: ${spawnErrors.join(" | ")}`,
  );
}

function buildCreateSessionResult(input: {
  activeSession: ActiveTerminalSession;
  isReused: boolean;
  sessionId: number;
}): CreateTerminalSessionResult {
  return {
    bufferedOutput: input.activeSession.outputBuffer,
    cwd: input.activeSession.cwd,
    isReused: input.isReused,
    sessionId: input.sessionId,
    shell: input.activeSession.shellLabel,
    venvName: input.activeSession.venvName,
    workspaceRootPath: input.activeSession.workspaceRootPath,
  };
}

function reuseExistingSession(input: {
  cols: number;
  isAiSession?: boolean;
  ownerWebContentsId: number;
  rows: number;
  sessionKey?: string | null;
  workspaceKey: string;
}) {
  const existingSessionId = findWorkspaceSessionId(
    input.ownerWebContentsId,
    toWorkspaceSessionKey(input.workspaceKey, input.sessionKey),
  );
  if (existingSessionId === null) {
    return null;
  }

  const activeSession = sessions.get(existingSessionId);
  if (
    !activeSession ||
    activeSession.ownerWebContentsId !== input.ownerWebContentsId ||
    activeSession.hasExited ||
    activeSession.isAiSession !== Boolean(input.isAiSession)
  ) {
    unregisterWorkspaceSession(
      input.ownerWebContentsId,
      toWorkspaceSessionKey(input.workspaceKey, input.sessionKey),
      existingSessionId,
    );
    return null;
  }

  if (
    activeSession.ptyProcess.cols !== input.cols ||
    activeSession.ptyProcess.rows !== input.rows
  ) {
    activeSession.ptyProcess.resize(input.cols, input.rows);
  }
  return buildCreateSessionResult({
    activeSession,
    isReused: true,
    sessionId: existingSessionId,
  });
}

async function createTerminalSessionInternal(
  sender: WebContents,
  input: CreateTerminalSessionInput,
): Promise<CreateTerminalSessionResult> {
  attachOwnerCleanup(sender);

  const cols = clampInteger(
    input.cols,
    TERMINAL_MIN_COLS,
    TERMINAL_MAX_COLS,
    120,
  );
  const rows = clampInteger(
    input.rows,
    TERMINAL_MIN_ROWS,
    TERMINAL_MAX_ROWS,
    30,
  );
  const workspaceRootPath = resolveTerminalWorkspaceRootPath(
    input.workspaceRootPath ?? input.cwd,
  );
  await assertTerminalWorkspaceDirectory(workspaceRootPath);
  const cwd = resolveTerminalCwd(workspaceRootPath, input.cwd);
  const workspaceKey = toWorkspaceKey(workspaceRootPath ?? cwd);
  const workspaceSessionKey = toWorkspaceSessionKey(
    workspaceKey,
    input.sessionKey,
  );
  const isAiSession = Boolean(input.isAiSession);
  const reusedSession = reuseExistingSession({
    cols,
    isAiSession,
    ownerWebContentsId: sender.id,
    sessionKey: input.sessionKey,
    rows,
    workspaceKey,
  });
  if (reusedSession) {
    return reusedSession;
  }

  const terminalEnvironment = createTerminalEnvironment(cwd, workspaceRootPath);
  const venvInfo = detectVenvInfo(workspaceRootPath ?? cwd, cwd);
  const venvName = venvInfo?.name ?? null;

  const { ptyProcess, shellLabel } = spawnTerminalFromCandidates({
    cols,
    cwd,
    env: terminalEnvironment,
    rows,
  });

  const sessionId = getNextSessionId();

  const activeSession: ActiveTerminalSession = {
    cwd,
    enableIdleTimeout: Boolean(input.enableIdleTimeout),
    exitCode: null,
    hasExited: false,
    idleTimerId: null,
    isAiSession,
    label: input.label ?? null,
    lastReadAt: Date.now(),
    outputBuffer: "",
    outputWaiters: new Set(),
    ownerWebContentsId: sender.id,
    ptyProcess,
    shellLabel,
    signal: null,
    venvName,
    workspaceRootPath: workspaceRootPath ?? cwd,
    workspaceSessionKey,
  };
  sessions.set(sessionId, activeSession);
  registerSessionWithOwner(sender.id, sessionId);
  registerWorkspaceSession(sender.id, workspaceSessionKey, sessionId);
  if (activeSession.enableIdleTimeout) {
    scheduleIdleTerminate(sessionId);
  }

  ptyProcess.onData((data) => {
    const sessionForData = sessions.get(sessionId);
    if (
      !sessionForData ||
      sessionForData.ownerWebContentsId !== sender.id ||
      sender.isDestroyed()
    ) {
      return;
    }

    appendSessionOutputBuffer(sessionForData, data);
    // Wake any pending getTerminalSessionOutput poll as soon as new output arrives.
    // This prevents execute_terminal from waiting the full polling timeout when a
    // command completion marker has already been written.
    notifySessionWaiters(sessionForData);
    const payload: TerminalDataEvent = {
      data,
      sessionId,
    };
    sender.send("terminal:session:data", payload);
  });

  ptyProcess.onExit((exitEvent) => {
    const sessionForExit = sessions.get(sessionId);
    if (!sessionForExit) {
      return;
    }

    sessionForExit.hasExited = true;
    sessionForExit.exitCode = exitEvent.exitCode;
    sessionForExit.signal =
      typeof exitEvent.signal === "number" ? exitEvent.signal : null;
    notifySessionWaiters(sessionForExit);
    if (!sender.isDestroyed()) {
      const payload: TerminalExitEvent = {
        exitCode: exitEvent.exitCode,
        sessionId,
        signal: sessionForExit.signal,
      };
      sender.send("terminal:session:exit", payload);
    }
  });

  return buildCreateSessionResult({
    activeSession,
    isReused: false,
    sessionId,
  });
}

export async function createTerminalSessionForWebContents(
  sender: WebContents,
  input: CreateTerminalSessionInput,
): Promise<CreateTerminalSessionResult> {
  return createTerminalSessionInternal(sender, input);
}

export async function createTerminalSession(
  event: IpcMainInvokeEvent,
  input: CreateTerminalSessionInput,
): Promise<CreateTerminalSessionResult> {
  return createTerminalSessionInternal(event.sender, input);
}

async function writeToTerminalSessionInternal(
  sender: WebContents,
  input: WriteTerminalSessionInput,
) {
  const activeSession = assertSessionOwnership(
    sender.id,
    input.sessionId,
    input.workspaceRootPath,
  );
  if (activeSession.hasExited) {
    throw new Error(`Terminal session ${input.sessionId} has already exited.`);
  }
  activeSession.ptyProcess.write(input.data);
}

export async function writeToTerminalSessionForWebContents(
  sender: WebContents,
  input: WriteTerminalSessionInput,
) {
  return writeToTerminalSessionInternal(sender, input);
}

export async function writeToTerminalSession(
  event: IpcMainInvokeEvent,
  input: WriteTerminalSessionInput,
) {
  return writeToTerminalSessionInternal(event.sender, input);
}

async function resizeTerminalSessionInternal(
  sender: WebContents,
  input: ResizeTerminalSessionInput,
) {
  const activeSession = assertSessionOwnership(
    sender.id,
    input.sessionId,
    input.workspaceRootPath,
  );
  if (activeSession.hasExited) {
    throw new Error(`Terminal session ${input.sessionId} has already exited.`);
  }
  const cols = clampInteger(
    input.cols,
    TERMINAL_MIN_COLS,
    TERMINAL_MAX_COLS,
    activeSession.ptyProcess.cols,
  );
  const rows = clampInteger(
    input.rows,
    TERMINAL_MIN_ROWS,
    TERMINAL_MAX_ROWS,
    activeSession.ptyProcess.rows,
  );
  if (
    activeSession.ptyProcess.cols === cols &&
    activeSession.ptyProcess.rows === rows
  ) {
    return;
  }
  activeSession.ptyProcess.resize(cols, rows);
}

export async function resizeTerminalSessionForWebContents(
  sender: WebContents,
  input: ResizeTerminalSessionInput,
) {
  return resizeTerminalSessionInternal(sender, input);
}

export async function resizeTerminalSession(
  event: IpcMainInvokeEvent,
  input: ResizeTerminalSessionInput,
) {
  return resizeTerminalSessionInternal(event.sender, input);
}

async function closeTerminalSessionInternal(
  sender: WebContents,
  input: CloseTerminalSessionInput,
) {
  assertSessionOwnership(sender.id, input.sessionId, input.workspaceRootPath);
  terminateSession(input.sessionId);
}

export async function closeTerminalSessionForWebContents(
  sender: WebContents,
  input: CloseTerminalSessionInput,
) {
  return closeTerminalSessionInternal(sender, input);
}

export async function closeTerminalSession(
  event: IpcMainInvokeEvent,
  input: CloseTerminalSessionInput,
) {
  return closeTerminalSessionInternal(event.sender, input);
}

export async function getTerminalSessionOutputForWebContents(
  sender: WebContents,
  input: TerminalSessionOutputInput,
): Promise<TerminalSessionSnapshot> {
  const activeSession = assertSessionOwnershipForRead(
    sender.id,
    input.sessionId,
    input.workspaceRootPath,
  );
  const pollingMs = clampTerminalPollingMs(input.pollingMs);
  await waitForTerminalSessionExitOrTimeout(activeSession, pollingMs);
  const refreshedSession = sessions.get(input.sessionId);
  if (!refreshedSession) {
    throw new Error(`Unknown terminal session id: ${input.sessionId}`);
  }

  if (refreshedSession.ownerWebContentsId !== sender.id) {
    throw new Error(
      `Terminal session ${input.sessionId} does not belong to this window.`,
    );
  }

  // Reset idle timer on every read
  refreshedSession.lastReadAt = Date.now();
  if (refreshedSession.enableIdleTimeout) {
    scheduleIdleTerminate(input.sessionId);
  }

  return createTerminalSessionSnapshot(input.sessionId, refreshedSession);
}

export function listSessionsForWebContents(
  sender: WebContents,
  workspaceRootPath: string,
): TerminalSessionInfo[] {
  const ownerSessions = ownerSessionIds.get(sender.id);
  if (!ownerSessions) return [];

  const normalizedWorkspace = normalizeWorkspacePath(workspaceRootPath);
  const result: TerminalSessionInfo[] = [];

  for (const sessionId of ownerSessions) {
    const session = sessions.get(sessionId);
    if (!session) continue;
    if (session.workspaceRootPath !== normalizedWorkspace) continue;
    result.push({
      cwd: session.cwd,
      hasExited: session.hasExited,
      label: session.label,
      lastReadAt: session.lastReadAt,
      sessionId,
      shellLabel: session.shellLabel,
      workspaceRootPath: session.workspaceRootPath,
    });
  }

  return result;
}

export function terminateSessionForWebContents(
  sender: WebContents,
  sessionId: number,
  workspaceRootPath: string,
  options?: { aiOnly?: boolean },
) {
  assertSessionOwnership(sender.id, sessionId, workspaceRootPath);
  const activeSession = sessions.get(sessionId);
  if (options?.aiOnly && (!activeSession || !activeSession.isAiSession)) {
    return;
  }
  terminateSession(sessionId);
}

export async function openExternalTerminalLink(
  input: OpenExternalTerminalLinkInput,
) {
  const safeUrl = parseExternalTerminalLink(input.url);
  await shell.openExternal(safeUrl);
}

export async function closeAllTerminalSessions() {
  const sessionIds = Array.from(sessions.keys());
  for (const sessionId of sessionIds) {
    terminateSession(sessionId);
  }
}
