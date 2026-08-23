import type { IPty } from "node-pty";

export const MAX_SESSION_OUTPUT_BUFFER_LENGTH = 300_000;

export interface ActiveTerminalSession {
  aiTurnId: string | null;
  capturePendingAiOutput: boolean;
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
  if (activeSession.capturePendingAiOutput) {
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

export function consumePendingAiOutput(
  activeSession: ActiveTerminalSession,
  pendingOutputLengthToConsume?: number,
) {
  if (activeSession.pendingAiOutputChunks.length === 0) {
    return "";
  }

  if (pendingOutputLengthToConsume === undefined) {
    const pendingOutput = activeSession.pendingAiOutputChunks.join("");
    activeSession.pendingAiOutputChunks = [];
    return pendingOutput;
  }

  if (!Number.isFinite(pendingOutputLengthToConsume) || pendingOutputLengthToConsume <= 0) {
    return "";
  }

  let remainingLength = Math.floor(pendingOutputLengthToConsume);
  let consumedOutput = "";

  while (remainingLength > 0 && activeSession.pendingAiOutputChunks.length > 0) {
    const firstChunk = activeSession.pendingAiOutputChunks[0] ?? "";
    if (firstChunk.length <= remainingLength) {
      consumedOutput += firstChunk;
      activeSession.pendingAiOutputChunks.shift();
      remainingLength -= firstChunk.length;
      continue;
    }

    consumedOutput += firstChunk.slice(0, remainingLength);
    activeSession.pendingAiOutputChunks[0] = firstChunk.slice(remainingLength);
    remainingLength = 0;
  }

  return consumedOutput;
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
