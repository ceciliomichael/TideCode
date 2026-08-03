import type { IPty } from "node-pty";

export const MAX_SESSION_OUTPUT_BUFFER_LENGTH = 300_000;

export interface ActiveTerminalSession {
  aiTurnId: string | null;
  cwd: string;
  exitCode: number | null;
  hasExited: boolean;
  isAiSession: boolean;
  label: string | null;
  outputBuffer: string;
  pendingAiOutputChunks: string[];
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
  pendingOutputBuffer: string;
  shellLabel: string;
  signal: number | null;
  sessionId: number;
}

export interface TerminalSessionInfo {
  cwd: string;
  hasExited: boolean;
  label: string | null;
  sessionId: number;
  shellLabel: string;
  workspaceRootPath: string;
}

export function appendSessionOutputBuffer(
  activeSession: ActiveTerminalSession,
  chunk: string,
) {
  const previousBufferLength = activeSession.outputBuffer.length;
  activeSession.outputBuffer += chunk;
  if (activeSession.isAiSession) {
    activeSession.pendingAiOutputChunks.push(chunk);
  }

  const clearScrollbackIndex = activeSession.outputBuffer.lastIndexOf("\x1b[3J");
  const resetIndex = activeSession.outputBuffer.lastIndexOf("\x1b[c");
  const lastClearIndex = Math.max(clearScrollbackIndex, resetIndex);

  if (lastClearIndex >= previousBufferLength) {
    activeSession.outputBuffer = activeSession.outputBuffer.slice(lastClearIndex);
  } else if (activeSession.outputBuffer.length > MAX_SESSION_OUTPUT_BUFFER_LENGTH) {
    const discardedLength = activeSession.outputBuffer.length - MAX_SESSION_OUTPUT_BUFFER_LENGTH;
    activeSession.outputBuffer = activeSession.outputBuffer.slice(
      discardedLength,
    );
  }
}

export function consumePendingAiOutput(activeSession: ActiveTerminalSession) {
  if (activeSession.pendingAiOutputChunks.length === 0) {
    return "";
  }

  const pendingOutput = activeSession.pendingAiOutputChunks.join("");
  activeSession.pendingAiOutputChunks = [];
  return pendingOutput;
}

export function createTerminalSessionSnapshot(
  sessionId: number,
  activeSession: ActiveTerminalSession,
): TerminalSessionSnapshot {
  return {
    cwd: activeSession.cwd,
    exitCode: activeSession.exitCode,
    hasExited: activeSession.hasExited,
    label: activeSession.label,
    outputBuffer: activeSession.outputBuffer,
    pendingOutputBuffer: activeSession.pendingAiOutputChunks.join(""),
    shellLabel: activeSession.shellLabel,
    signal: activeSession.signal,
    sessionId,
  };
}

export function notifySessionWaiters(activeSession: ActiveTerminalSession) {
  const waiters = Array.from(activeSession.outputWaiters.values());
  activeSession.outputWaiters.clear();
  for (const resolve of waiters) {
    resolve();
  }
}
