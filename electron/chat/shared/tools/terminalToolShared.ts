import { randomInt } from "node:crypto";
import path from "node:path";
import type { WebContents } from "electron";
import type { ChatStreamEventTarget } from "../runtimeStreamEvents";
import type {
  ChatStreamEvent,
  CreateTerminalSessionInput,
  CreateTerminalSessionResult,
  ResizeTerminalSessionInput,
  TerminalSessionOutputInput,
  WriteTerminalSessionInput,
  TerminalBrokerOperationSnapshot,
  TerminalBrokerOperationState,
} from "../../../../src/types/chat";
import type { AgentToolContext, AgentToolExecutionResult } from "../toolTypes";
import type { TerminalSessionSnapshot } from "../../../terminal/service";
import { MAX_TERMINAL_POLLING_MS } from "../../../terminal/configuration";
import { AiTerminalTranscript } from "../../../terminal/aiTranscript";
import {
  formatTerminalScreenForDisplay,
  formatTerminalScreenForModel,
  TerminalScreenModel,
} from "../../../terminal/screenModel";
import {
  TerminalInteractionDetector,
  type TerminalInteractionDetection,
} from "../../../terminal/interactionDetector";
import {
  assertSandboxCommandWorkingDirectories,
  assertSandboxPathDoesNotEscapeThroughSymlink,
  getSandboxPathRoots,
  resolveSandboxPath,
  type SandboxPathRoots,
} from "./sandboxPaths";

const MIN_VISIBLE_SESSION_ID = 10_000;
const MAX_VISIBLE_SESSION_ID_EXCLUSIVE = 100_000;
const MAX_VISIBLE_SESSION_ID_ATTEMPTS = 1_000;
const COMPLETION_MARKER_PROBE_LENGTH = 128;
const MAX_INTERACTION_TEXT_LENGTH = 16_000;

let nextSyntheticTerminalOwnerId = -1;

function isTerminalSessionOwner(
  target: WebContents | ChatStreamEventTarget,
): target is WebContents {
  const candidate = target as Partial<WebContents>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.isDestroyed === "function" &&
    typeof candidate.once === "function" &&
    typeof candidate.send === "function"
  );
}

/**
 * Terminal sessions need a WebContents-like owner for identity and lifecycle,
 * while CLI/run-service chats only provide a lightweight stream-event target.
 * Wrap headless targets with a run-scoped owner instead of casting them to
 * WebContents and crashing when the terminal service calls `once()`.
 */
export function createTerminalSessionOwner(
  target: WebContents | ChatStreamEventTarget,
): WebContents {
  if (isTerminalSessionOwner(target)) {
    return target;
  }

  const owner = {
    id: nextSyntheticTerminalOwnerId--,
    isDestroyed: () => target.isDestroyed?.() ?? false,
    once: () => owner,
    send: (channel: string, payload: unknown) => {
      if (channel !== "chat:stream:event") {
        return;
      }
      if (typeof target.send === "function") {
        target.send(channel, payload);
        return;
      }
      target.emit?.(payload as ChatStreamEvent);
    },
  } as unknown as WebContents;
  return owner;
}

export interface TerminalToolDependencies {
  createOperation?: (
    ownerWebContents: WebContents,
    input: { command: string; cwd: string; sessionId: number; toolCallId?: string | null },
  ) => Promise<TerminalBrokerOperationSnapshot>;
  createSession: (
    ownerWebContents: WebContents,
    input: CreateTerminalSessionInput,
  ) => Promise<CreateTerminalSessionResult>;
  getSessionOutput: (
    ownerWebContents: WebContents,
    input: TerminalSessionOutputInput,
  ) => Promise<TerminalSessionSnapshot>;
  consumeSessionOutput: (
    ownerWebContents: WebContents,
    input: TerminalSessionOutputInput,
  ) => void;
  terminateSessionsForTurn: (
    ownerWebContents: WebContents,
    turnId: string,
    workspaceRootPath: string,
  ) => void;
  transitionOperation?: (
    operationId: string,
    state: TerminalBrokerOperationState,
    update?: Partial<Pick<TerminalBrokerOperationSnapshot, "endCursor" | "exitCode" | "termination">>,
  ) => Promise<TerminalBrokerOperationSnapshot>;
  terminateSession: (
    ownerWebContents: WebContents,
    sessionId: number,
    workspaceRootPath: string,
  ) => void;
  writeToSession: (
    ownerWebContents: WebContents,
    input: WriteTerminalSessionInput,
  ) => Promise<void>;
  resizeSession: (
    ownerWebContents: WebContents,
    input: ResizeTerminalSessionInput,
  ) => Promise<void>;
}

export interface TerminalToolRuntime {
  context: AgentToolContext;
  getDependencies: () => Promise<TerminalToolDependencies>;
  namespace: string;
  ownerWebContents: WebContents | null;
  terminalExecutionMode: NonNullable<AgentToolContext["terminalExecutionMode"]>;
}

export type TerminalCommandState = "completed" | "needs_interaction" | "running";

export interface ThreadAiSession {
  brokerOperationId: string | null;
  brokerOperationState: TerminalBrokerOperationState | null;
  brokerSessionId: string | null;
  command: string;
  commandComplete: boolean;
  commandExitCode: number | null;
  completionMarker: string;
  completionMarkerProbe: string;
  cwd: string;
  detector: TerminalInteractionDetector;
  globalSessionId: number;
  interaction: TerminalInteractionDetection | null;
  interactionMode: "auto" | "non_interactive" | "interactive";
  isDaemon: boolean;
  label: string | null;
  localSessionId: number;
  nextUnreadLine: number;
  screen: TerminalScreenModel;
  shell: string;
  transcript: AiTerminalTranscript;
  lastSnapshot: TerminalSessionSnapshot | null;
}

export interface ThreadSessionStore {
  latestLocalSessionId: number | null;
  reservedSessionIds: Set<number>;
  sessions: Map<number, ThreadAiSession>;
}

export interface TerminalCommandSummary {
  body: string;
  displayBody: string;
  semantics: Record<string, unknown>;
  state: TerminalCommandState;
  summary: string;
}

export const threadStores = new Map<string, ThreadSessionStore>();

function toAbortError(abortSignal: AbortSignal | undefined) {
  const reason = abortSignal?.reason;
  if (reason instanceof Error) {
    return reason;
  }

  return new Error("Terminal tool execution aborted.");
}

export function throwIfAborted(abortSignal: AbortSignal | undefined) {
  if (abortSignal?.aborted) {
    throw toAbortError(abortSignal);
  }
}

export function raceWithAbort<T>(promise: Promise<T>, abortSignal: AbortSignal | undefined) {
  if (!abortSignal) {
    return promise;
  }

  if (abortSignal.aborted) {
    return Promise.reject(toAbortError(abortSignal));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      abortSignal.removeEventListener("abort", handleAbort);
      reject(toAbortError(abortSignal));
    };

    abortSignal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        abortSignal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        abortSignal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

export function createSuccessResult(input: Omit<AgentToolExecutionResult, "status">): AgentToolExecutionResult {
  return {
    ...input,
    status: "success",
  };
}

export function createErrorResult(summary: string, body?: string): AgentToolExecutionResult {
  return {
    ...(body ? { body } : {}),
    status: "error",
    summary,
  };
}

export function createTerminalErrorResult(
  summary: string,
  displaySummary = summary,
  body?: string,
): AgentToolExecutionResult {
  return {
    ...createErrorResult(summary, body),
    displayBody: displaySummary,
  };
}

async function loadDefaultTerminalToolDependencies(context: AgentToolContext): Promise<TerminalToolDependencies> {
  const { createTerminalBrokerToolDependencies } = await import("./terminalBrokerAdapter");
  return createTerminalBrokerToolDependencies(context);
}

export function createTerminalToolRuntime(
  context: AgentToolContext,
  dependencies: Partial<TerminalToolDependencies> = {},
): TerminalToolRuntime {
  let resolvedDependencies: TerminalToolDependencies | null = null;
  const getDependencies = async () => {
    if (!resolvedDependencies) {
      const defaults = await loadDefaultTerminalToolDependencies(context);
      resolvedDependencies = Object.freeze(Object.assign({}, defaults, {
        consumeSessionOutput:
          dependencies.consumeSessionOutput ?? defaults.consumeSessionOutput,
        createSession: dependencies.createSession ?? defaults.createSession,
        createOperation: dependencies.createOperation
          ?? (dependencies.createSession ? undefined : defaults.createOperation),
        getSessionOutput: dependencies.getSessionOutput ?? defaults.getSessionOutput,
        terminateSession: dependencies.terminateSession ?? defaults.terminateSession,
        writeToSession: dependencies.writeToSession ?? defaults.writeToSession,
        resizeSession: dependencies.resizeSession ?? defaults.resizeSession,
        terminateSessionsForTurn:
          dependencies.terminateSessionsForTurn ?? defaults.terminateSessionsForTurn,
        transitionOperation: dependencies.transitionOperation
          ?? (dependencies.createSession ? undefined : defaults.transitionOperation),
      }));
    }
    return resolvedDependencies;
  };

  return {
    context,
    getDependencies,
    namespace: resolveTerminalThreadNamespace(context),
    ownerWebContents: (context.webContents as WebContents | null) ?? null,
    terminalExecutionMode: context.terminalExecutionMode ?? "sandbox",
  };
}

export function getOrCreateThreadStore(namespace: string) {
  let store = threadStores.get(namespace);
  if (!store) {
    store = {
      latestLocalSessionId: null,
      reservedSessionIds: new Set(),
      sessions: new Map(),
    };
    threadStores.set(namespace, store);
  }
  return store;
}

export function allocateVisibleSessionId(store: ThreadSessionStore) {
  for (let attempt = 0; attempt < MAX_VISIBLE_SESSION_ID_ATTEMPTS; attempt += 1) {
    const candidate = randomInt(MIN_VISIBLE_SESSION_ID, MAX_VISIBLE_SESSION_ID_EXCLUSIVE);
    if (store.sessions.has(candidate) || store.reservedSessionIds.has(candidate)) {
      continue;
    }

    store.reservedSessionIds.add(candidate);
    return candidate;
  }

  throw new Error("Unable to allocate a unique terminal session ID.");
}

export function resolveTerminalThreadNamespace(context: AgentToolContext) {
  const turnId = context.turnId?.trim();
  if (turnId) {
    return `turn:${turnId}`;
  }

  const conversationId = context.conversationId?.trim();
  if (conversationId) {
    return `conversation:${conversationId}`;
  }

  return `workspace:${context.workspaceRootPath}`;
}

export function resolveTerminalWorkspaceCwd(context: AgentToolContext, cwd: string | undefined) {
  const terminalExecutionMode = context.terminalExecutionMode ?? "sandbox";
  if (terminalExecutionMode === "sandbox") {
    return resolveSandboxPath(context.workspaceRootPath, cwd);
  }

  const normalizedCwd = cwd?.trim() ?? "";
  return {
    absolutePath:
      normalizedCwd.length === 0
        ? context.workspaceRootPath
        : path.resolve(context.workspaceRootPath, normalizedCwd),
    roots: getSandboxPathRoots(context.workspaceRootPath),
  };
}

function isGitDiffCommand(command: string) {
  return /(?:^|[;&|]\s*)git(?:\s+--no-pager)?\s+diff(?:\s|$)/iu.test(command.trim());
}

function preventGitDiffPager(command: string) {
  return command.replace(/(^|[;&|]\s*)git\s+diff(\s|$)/giu, "$1git --no-pager diff$2");
}

export function prepareTerminalCommand(command: string) {
  return isGitDiffCommand(command) ? preventGitDiffPager(command) : command;
}

export function normalizeCommand(command: unknown) {
  if (typeof command !== "string") {
    return null;
  }

  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const boundedValue = Math.floor(value);
  return Math.min(max, Math.max(min, boundedValue));
}

export function createCompletionMarker(localSessionId: number) {
  return `__EDONE_${localSessionId.toString(36)}_${Date.now().toString(36)}__`;
}

function encodePowerShellCommand(command: string) {
  const encodedCommand = Buffer.from(command, "utf8").toString("base64");
  return `Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedCommand}')))`;
}

export function buildMarkedCommand(command: string, shellLabel: string, marker: string) {
  const normalizedShellLabel = shellLabel.toLowerCase();
  const trimmedCommand = command.trimEnd();

  if (normalizedShellLabel.includes("powershell") || normalizedShellLabel.includes("pwsh")) {
    const shellCommand = encodePowerShellCommand(trimmedCommand);
    return [
      "$global:LASTEXITCODE = 0",
      "$__tidecodeSucceeded = $true",
      `try { ${shellCommand}; $__tidecodeSucceeded = $? } catch { Write-Error $_; $__tidecodeSucceeded = $false }`,
      "$__tidecodeExit = if ($__tidecodeSucceeded) { [int]$LASTEXITCODE } elseif ([int]$LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } else { 1 }",
      `Write-Output "${marker}:$__tidecodeExit"`,
    ].join("; ") + "\r";
  }

  if (
    normalizedShellLabel.includes("command prompt") ||
    normalizedShellLabel === "cmd" ||
    normalizedShellLabel.includes("cmd.exe")
  ) {
    return `${trimmedCommand} & echo ${marker}:%ERRORLEVEL%\r`;
  }

  return `${trimmedCommand}; echo "${marker}:$?"\r`;
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readOsc133CompletionCode(value: string): number | null {
  const match = /\x1b\]133;D(?:;(-?\d+))?(?:\x07|\x1b\\)/u.exec(value);
  if (match) {
    return match[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
  }
  return null;
}

const DAEMON_SERVER_PATTERNS = [
  /Local:\s+https?:\/\/[^\s]+/i,
  /Network:\s+https?:\/\/[^\s]+/i,
  /listening on (?:port |http|\/|::|\d)/i,
  /ready in \d+(?:\.\d+)?\s*(?:ms|s)/i,
  /Compiled successfully/i,
  /webpack (?:compiled|\d+\.\d+)/i,
  /watching for (?:file )?changes/i,
  /Application (?:started|running at)/i,
  /Uvicorn running on/i,
  /Development server is running at/i,
  /Server running at/i,
  /Started development server/i,
  /press h \+ enter to show help/i,
];

export function detectDaemonOrServer(value: string): boolean {
  return DAEMON_SERVER_PATTERNS.some((pattern) => pattern.test(value));
}

export function getRecentTranscriptTail(
  session: ThreadAiSession,
  maxLines = 5,
): { lineNumber: number; text: string }[] {
  session.transcript.finalize();
  const summary = session.transcript.getSummary();
  if (summary.lineCount === 0) {
    return [];
  }
  const startLine = Math.max(1, summary.lineCount - maxLines + 1);
  const result = session.transcript.read(startLine, maxLines);
  return result.lines;
}

export function readCompletionCode(value: string, marker: string) {
  const osc133ExitCode = readOsc133CompletionCode(value);
  if (osc133ExitCode !== null) {
    return osc133ExitCode;
  }

  const match = new RegExp(`${escapeRegularExpression(marker)}:(-?\\d+)`, "u").exec(value);
  return match ? Number.parseInt(match[1], 10) : null;
}

function observeActiveScreenInteraction(session: ThreadAiSession) {
  if (
    session.commandComplete ||
    session.interactionMode === "non_interactive" ||
    session.screen.getSnapshot().activeBuffer !== "alternate"
  ) {
    return;
  }

  session.interaction = {
    confidence: "medium",
    hint: "An interactive terminal screen is active.",
    kind: "screen",
    reason: "active_alternate_screen",
  };
}

async function observePendingOutput(
  session: ThreadAiSession,
  dependencies: TerminalToolDependencies,
  ownerWebContents: WebContents,
  workspaceRootPath: string,
  snapshot: TerminalSessionSnapshot,
) {
  const pendingOutput = snapshot.pendingOutputBuffer;
  session.lastSnapshot = snapshot;

  if (pendingOutput.length > 0) {
    await session.screen.write(pendingOutput);
    const markerProbe = `${session.completionMarkerProbe}${pendingOutput}`;
    const commandExitCode = readCompletionCode(markerProbe, session.completionMarker);
    session.transcript.append(pendingOutput);

    if (commandExitCode !== null) {
      session.commandComplete = true;
      session.commandExitCode = commandExitCode;
      session.completionMarkerProbe = "";
      session.interaction = null;
    } else {
      session.completionMarkerProbe = markerProbe.slice(
        -Math.max(COMPLETION_MARKER_PROBE_LENGTH, session.completionMarker.length + 32),
      );
      if (session.interactionMode !== "non_interactive") {
        const detection = session.detector.observe(pendingOutput, session.interactionMode);
        if (detection) {
          session.interaction = detection;
        }
      }
      if (!session.isDaemon && detectDaemonOrServer(markerProbe)) {
        session.isDaemon = true;
      }
    }

    observeActiveScreenInteraction(session);

    dependencies.consumeSessionOutput(ownerWebContents, {
      pendingOutputLengthToConsume: pendingOutput.length,
      sessionId: session.globalSessionId,
      workspaceRootPath,
    });
  }

  if (snapshot.hasExited) {
    session.commandComplete = true;
    if (session.commandExitCode === null) {
      session.commandExitCode = snapshot.exitCode;
    }
    session.interaction = null;
  }

  observeActiveScreenInteraction(session);

  if (session.commandComplete) {
    session.transcript.finalize();
  }
}

export async function syncTerminalSessionOutput(
  runtime: TerminalToolRuntime,
  session: ThreadAiSession,
  dependencies: TerminalToolDependencies,
  abortSignal: AbortSignal | undefined,
  pollingMs: number,
) {
  if (!runtime.ownerWebContents) {
    throw new Error("Terminal execution requires an active renderer context.");
  }

  throwIfAborted(abortSignal);
  const snapshot = await raceWithAbort(
    dependencies.getSessionOutput(runtime.ownerWebContents, {
      pollingMs,
      sessionId: session.globalSessionId,
      workspaceRootPath: runtime.context.workspaceRootPath,
    }),
    abortSignal,
  );
  await observePendingOutput(
    session,
    dependencies,
    runtime.ownerWebContents,
    runtime.context.workspaceRootPath,
    snapshot,
  );
  return snapshot;
}

export async function waitForTerminalCommand(
  runtime: TerminalToolRuntime,
  session: ThreadAiSession,
  dependencies: TerminalToolDependencies,
  abortSignal: AbortSignal | undefined,
) {
  const startedAt = Date.now();
  let snapshot = session.lastSnapshot;

  while (!session.commandComplete) {
    throwIfAborted(abortSignal);

    if (session.interaction) {
      return {
        snapshot,
        state: "needs_interaction" as const,
      };
    }

    const remainingMs = MAX_TERMINAL_POLLING_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      return {
        snapshot,
        state: "running" as const,
      };
    }

    snapshot = await syncTerminalSessionOutput(
      runtime,
      session,
      dependencies,
      abortSignal,
      Math.min(MAX_TERMINAL_POLLING_MS, remainingMs),
    );
  }

  session.transcript.finalize();
  return {
    snapshot,
    state: "completed" as const,
  };
}

export const MAX_TERMINAL_WAIT_SECONDS = 300;

export function getTerminalCommandState(session: ThreadAiSession): TerminalCommandState {
  if (session.commandComplete) {
    return "completed";
  }
  if (session.interaction) {
    return "needs_interaction";
  }
  return "running";
}

export function buildTerminalCommandSummary(
  session: ThreadAiSession,
  options: { includeScreen?: boolean } = {},
): TerminalCommandSummary {
  const state = getTerminalCommandState(session);
  const transcriptSummary = session.transcript.getSummary();
  const snapshot = session.lastSnapshot;
  const exitCode = session.commandExitCode ?? snapshot?.exitCode ?? null;
  const interaction = session.interaction;
  const status = state === "running"
    ? session.isDaemon
      ? "daemon_listening"
      : "actively_executing"
    : state === "needs_interaction"
      ? "waiting_for_input"
      : exitCode !== null && exitCode !== 0
        ? "failed"
        : "completed";

  const bodyLines = [
    `session_id: ${session.localSessionId}`,
    `state: ${state}`,
    `status: ${status}`,
    `total_output_lines: ${transcriptSummary.lineCount}`,
  ];
  if (state === "completed" && exitCode !== null && exitCode !== 0) {
    bodyLines.push("result: failed");
  }
  if (transcriptSummary.truncated) {
    bodyLines.push(
      `available_lines: ${transcriptSummary.firstAvailableLine}-${transcriptSummary.lastAvailableLine}`,
    );
  }
  if (interaction) {
    bodyLines.push(`input_required: ${interaction.kind}`);
    bodyLines.push(`prompt: ${interaction.hint}`);
  }
  if (options.includeScreen && interaction?.kind === "screen") {
    bodyLines.push(formatTerminalScreenForModel(session.screen.getSnapshot()));
  }
  if (state === "running") {
    if (session.isDaemon) {
      bodyLines.push(
        "",
        "guidance: A long-running web server or background daemon was detected and is running. It will not exit on its own. Do not wait in a polling loop; proceed with other tasks or send Ctrl+C using interact_terminal to stop it.",
      );
    } else {
      bodyLines.push(
        "",
        "guidance: Process is actively executing in the background and has not exited. Use interact_terminal to wait for output or send Ctrl+C to cancel. Do not re-run this command while the session is active.",
      );
    }
  }
  const body = bodyLines.join("\n");
  const displayBodyLines: string[] = [];

  if (state === "needs_interaction") {
    if (interaction?.kind === "screen") {
      displayBodyLines.push(formatTerminalScreenForDisplay(session.screen.getSnapshot()));
    } else if (interaction?.hint) {
      displayBodyLines.push(interaction.hint);
    } else {
      displayBodyLines.push("Waiting for terminal input.");
    }
  } else if (state === "completed") {
    if (exitCode !== null && exitCode !== 0) {
      displayBodyLines.push("Terminal command failed.");
    }
  }

  return {
    body,
    displayBody: displayBodyLines.join("\n"),
    semantics: {
      active: state === "running",
      available_line_count: transcriptSummary.availableLineCount,
      first_available_line: transcriptSummary.firstAvailableLine,
      interaction_confidence: interaction?.confidence ?? null,
      interaction_kind: interaction?.kind ?? null,
      interaction_required: interaction !== null,
      last_available_line: transcriptSummary.lastAvailableLine,
      line_count: transcriptSummary.lineCount,
      session_id: session.localSessionId,
      state,
      status: state === "running" ? "actively_executing" : state === "needs_interaction" ? "waiting_for_input" : exitCode !== null && exitCode !== 0 ? "failed" : "completed",
      output_evicted: transcriptSummary.truncated,
    },
    state,
    summary: state === "needs_interaction"
      ? `Terminal session ${session.localSessionId} needs interaction`
      : state === "completed"
        ? exitCode !== null && exitCode !== 0
          ? `Terminal session ${session.localSessionId} failed`
          : `Completed terminal session ${session.localSessionId}`
        : `Terminal session ${session.localSessionId} is still running`,
  };
}

export function createTerminalCommandResult(
  session: ThreadAiSession,
  summary: TerminalCommandSummary,
) {
  return createSuccessResult({
    body: summary.body,
    displayBody: summary.displayBody,
    semantics: summary.semantics,
    subject: { kind: "session", path: String(session.localSessionId) },
    summary: summary.summary,
  });
}

export function getThreadSession(store: ThreadSessionStore, sessionId: number) {
  return store.sessions.get(sessionId) ?? null;
}

export function resetThreadSessionForCommand(
  session: ThreadAiSession,
  command: string,
  marker: string,
  interactionMode: ThreadAiSession["interactionMode"],
) {
  session.command = command;
  session.commandComplete = false;
  session.commandExitCode = null;
  session.completionMarker = marker;
  session.completionMarkerProbe = "";
  session.detector.reset();
  session.interaction = null;
  session.interactionMode = interactionMode;
  session.isDaemon = false;
  session.lastSnapshot = null;
  session.nextUnreadLine = 1;
  session.screen.reset();
  session.transcript.reset({ command, marker });
}

export function createThreadAiSession(input: {
  brokerSessionId?: string | null;
  cols: number;
  command: string;
  cwd: string;
  globalSessionId: number;
  interactionMode: ThreadAiSession["interactionMode"];
  label: string | null;
  localSessionId: number;
  marker: string;
  rows: number;
  shell: string;
}) {
  const session: ThreadAiSession = {
    brokerOperationId: null,
    brokerOperationState: null,
    brokerSessionId: input.brokerSessionId ?? null,
    command: input.command,
    commandComplete: false,
    commandExitCode: null,
    completionMarker: input.marker,
    completionMarkerProbe: "",
    cwd: input.cwd,
    detector: new TerminalInteractionDetector(),
    globalSessionId: input.globalSessionId,
    interaction: null,
    interactionMode: input.interactionMode,
    isDaemon: false,
    label: input.label,
    lastSnapshot: null,
    localSessionId: input.localSessionId,
    nextUnreadLine: 1,
    screen: new TerminalScreenModel({ cols: input.cols, rows: input.rows }),
    shell: input.shell,
    transcript: new AiTerminalTranscript(),
  };
  session.transcript.reset({ command: input.command, marker: input.marker });
  return session;
}

export async function synchronizeBrokerOperation(
  session: ThreadAiSession,
  dependencies: TerminalToolDependencies,
) {
  if (!session.brokerOperationId || !dependencies.transitionOperation) return;
  const nextState: TerminalBrokerOperationState = session.commandComplete
    ? session.commandExitCode !== null && session.commandExitCode !== 0
      ? "command_failed"
      : "completed"
    : session.interaction
      ? "needs_interaction"
      : "running";
  if (session.brokerOperationState === nextState) return;
  const update = session.commandComplete
    ? { exitCode: session.commandExitCode }
    : undefined;
  await dependencies.transitionOperation(session.brokerOperationId, nextState, update);
  session.brokerOperationState = nextState;
}

export function drainUnreadTerminalOutput(session: ThreadAiSession) {
  session.transcript.finalize();
  const result = session.transcript.read(session.nextUnreadLine, Number.MAX_SAFE_INTEGER);
  const lastLine = result.lines[result.lines.length - 1];
  if (lastLine) {
    session.nextUnreadLine = lastLine.lineNumber + 1;
  } else if (result.skippedEvictedLines) {
    session.nextUnreadLine = Math.max(session.nextUnreadLine, result.summary.firstAvailableLine);
  }

  return result;
}

export function encodeTerminalInput(text: string | undefined, keys: string[] | undefined) {
  const rawText = text ?? "";
  if (rawText.length > MAX_INTERACTION_TEXT_LENGTH) {
    throw new Error(`Interactive terminal input cannot exceed ${MAX_INTERACTION_TEXT_LENGTH} characters.`);
  }
  if (rawText.includes("\u0000")) {
    throw new Error("Interactive terminal input cannot contain a null character.");
  }

  // PTY Enter is carriage return. Normalize model-friendly text newlines so
  // line-oriented console readers such as PowerShell [Console]::In.ReadLine()
  // receive the same input as an actual Enter keypress.
  const normalizedText = rawText.replace(/\r\n|\n/gu, "\r");

  const keyMap: Record<string, string> = {
    ALT_LEFT: "\u001B[D",
    ALT_RIGHT: "\u001B[C",
    BACKSPACE: "\u007F",
    CTRL_C: "\u0003",
    CTRL_D: "\u0004",
    CTRL_L: "\u000C",
    DOWN: "\u001B[B",
    END: "\u001B[F",
    ENTER: "\r",
    RETURN: "\r",
    ESC: "\u001B",
    HOME: "\u001B[H",
    LEFT: "\u001B[D",
    RIGHT: "\u001B[C",
    SPACE: " ",
    TAB: "\t",
    UP: "\u001B[A",
  };

  let encodedKeys = "";
  const requestedKeys = keys ?? [];
  if (requestedKeys.length > 100) {
    throw new Error("Interactive terminal input cannot contain more than 100 keys.");
  }

  for (const key of requestedKeys) {
    if (key.length === 1 && key >= " " && key !== "\u007F") {
      encodedKeys += key;
      continue;
    }

    const normalizedKey = key.trim().toUpperCase();
    const encodedKey = keyMap[normalizedKey];
    if (!encodedKey) {
      throw new Error(`Unsupported terminal key: ${key}`);
    }
    encodedKeys += encodedKey;
  }

  return `${normalizedText}${encodedKeys}`;
}

export function removeThreadSession(store: ThreadSessionStore, sessionId: number) {
  const session = store.sessions.get(sessionId);
  if (!session) {
    return;
  }
  session.screen.dispose();
  store.sessions.delete(sessionId);
  store.reservedSessionIds.delete(session.localSessionId);
  if (store.latestLocalSessionId === session.localSessionId) {
    store.latestLocalSessionId = Array.from(store.sessions.keys()).pop() ?? null;
  }
}

export function assertSandboxCommand(
  runtime: TerminalToolRuntime,
  command: string,
  cwd: string,
  roots: SandboxPathRoots,
) {
  if (runtime.terminalExecutionMode !== "sandbox") {
    return Promise.resolve();
  }

  return Promise.all(
    [cwd, ...assertSandboxCommandWorkingDirectories(command, runtime.context.workspaceRootPath, cwd)].map(
      (directoryPath) => assertSandboxPathDoesNotEscapeThroughSymlink(directoryPath, roots),
    ),
  ).then(() => undefined);
}

export function assertTerminalOwner(runtime: TerminalToolRuntime): asserts runtime is TerminalToolRuntime & {
  ownerWebContents: WebContents;
} {
  if (!runtime.ownerWebContents || runtime.ownerWebContents.isDestroyed()) {
    throw new Error("Terminal execution requires an active renderer context.");
  }
}

export async function terminateAllBackgroundSessions(
  webContents: WebContents | ChatStreamEventTarget | null | undefined,
  workspaceRootPath: string,
  conversationIdOrTerminate?: string | null | ((
    webContents: WebContents | ChatStreamEventTarget | null | undefined,
    sessionId: number,
    workspaceRootPath: string,
  ) => void),
  customTerminateSession?: (
    webContents: WebContents | ChatStreamEventTarget | null | undefined,
    sessionId: number,
    workspaceRootPath: string,
  ) => void,
) {
  const conversationId = typeof conversationIdOrTerminate === "string"
    ? conversationIdOrTerminate.trim()
    : "";
  const terminateSession = typeof conversationIdOrTerminate === "function"
    ? conversationIdOrTerminate
    : customTerminateSession;
  const dependencies = terminateSession ? null : await loadDefaultTerminalToolDependencies({
    conversationId: conversationId || null,
    workspaceRootPath,
    webContents,
  });
  const namespaces = conversationId
    ? [`conversation:${conversationId}`]
    : Array.from(threadStores.keys());

  for (const namespace of namespaces) {
    const store = threadStores.get(namespace);
    if (!store) {
      continue;
    }

    for (const session of store.sessions.values()) {
      try {
        if (terminateSession) {
          terminateSession(webContents as any, session.globalSessionId, workspaceRootPath);
        } else if (webContents && dependencies) {
          dependencies.terminateSession(webContents as any, session.globalSessionId, workspaceRootPath);
        }
      } catch {
        // Continue terminating the remaining sessions.
      } finally {
        session.screen.dispose();
      }
    }
    threadStores.delete(namespace);
  }
}

export async function terminateAllBackgroundSessionsForTurn(
  webContents: WebContents | ChatStreamEventTarget | null | undefined,
  workspaceRootPath: string,
  turnId: string,
  customTerminateSession?: (
    webContents: WebContents | ChatStreamEventTarget | null | undefined,
    sessionId: number,
    workspaceRootPath: string,
  ) => void,
) {
  const normalizedTurnId = turnId.trim();
  if (!normalizedTurnId) {
    return;
  }

  const namespace = `turn:${normalizedTurnId}`;
  const store = threadStores.get(namespace);
  const dependencies = customTerminateSession ? null : await loadDefaultTerminalToolDependencies({
    turnId: normalizedTurnId,
    workspaceRootPath,
    webContents,
  });

  try {
    if (store) {
      for (const session of store.sessions.values()) {
        try {
          if (customTerminateSession) {
            customTerminateSession(webContents as any, session.globalSessionId, workspaceRootPath);
          } else if (webContents && dependencies) {
            dependencies.terminateSession(webContents as any, session.globalSessionId, workspaceRootPath);
          }
        } catch {
          // Continue terminating the remaining sessions in this turn.
        } finally {
          session.screen.dispose();
        }
      }
    }

    if (webContents && dependencies) {
      dependencies.terminateSessionsForTurn(webContents as any, normalizedTurnId, workspaceRootPath);
    }
  } finally {
    threadStores.delete(namespace);
  }
}

export function releaseTerminalToolStateForTurn(turnId: string) {
  const normalizedTurnId = turnId.trim();
  if (!normalizedTurnId) return;
  const namespace = `turn:${normalizedTurnId}`;
  const store = threadStores.get(namespace);
  if (store) {
    for (const session of store.sessions.values()) session.screen.dispose();
  }
  threadStores.delete(namespace);
}
