import type { IpcMainInvokeEvent, WebContents } from "electron";
import { normalizeWorkspacePath } from "../workspace/paths";
import { detectVenvInfo } from "../python/venv";
import { openExternalWithElectronShell } from "../runtime/electronShell";
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
import {
  assertTerminalWorkspaceDirectory,
  clampTerminalColumns,
  clampTerminalPollingMs,
  clampTerminalRows,
  createTerminalEnvironment,
  parseExternalTerminalLink,
  resolveTerminalCwd,
  resolveTerminalWorkspaceRootPath,
  spawnResolvedTerminalShell,
  toWorkspaceKey,
  toWorkspaceSessionKey,
} from "./configuration";
import {
  appendSessionOutputBuffer,
  consumePendingAiOutput,
  createTerminalSessionSnapshot,
  notifySessionWaiters,
  type ActiveTerminalSession,
  type TerminalSessionInfo,
  type TerminalSessionSnapshot,
} from "./sessionModel";
export type { TerminalSessionInfo, TerminalSessionSnapshot } from "./sessionModel";

import {
  assertSessionOwnership,
  assertSessionOwnershipForRead,
  attachOwnerCleanup,
  findWorkspaceSessionId,
  getSessionIdsForOwner,
  getNextSessionId,
  registerSessionWithOwner,
  registerWorkspaceSession,
  sessions,
  terminateAiSessionsForTurn,
  terminateSession,
  unregisterWorkspaceSession,
} from "./sessionRegistry";

type InternalCreateTerminalSessionInput = CreateTerminalSessionInput & {
  capturePendingAiOutput?: boolean;
};

function waitForTerminalSessionExitOrTimeout(
  activeSession: ActiveTerminalSession,
  pollingMs: number,
) {
  if (
    pollingMs <= 0 ||
    activeSession.hasExited ||
    activeSession.pendingAiOutputChunks.length > 0
  ) {
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

function buildCreateSessionResult(input: {
  activeSession: ActiveTerminalSession;
  isReused: boolean;
  sessionId: number;
}): CreateTerminalSessionResult {
  return {
    bufferedOutput: input.activeSession.outputBuffer,
    cwd: input.activeSession.cwd,
    isReused: input.isReused,
    processId: input.activeSession.ptyProcess.pid,
    sessionId: input.sessionId,
    shell: input.activeSession.shellLabel,
    venvName: input.activeSession.venvName,
    workspaceRootPath: input.activeSession.workspaceRootPath,
  };
}

function reuseExistingSession(input: {
  aiTurnId: string | null;
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
    activeSession.isAiSession !== Boolean(input.isAiSession) ||
    activeSession.aiTurnId !== input.aiTurnId
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
  input: InternalCreateTerminalSessionInput,
): Promise<CreateTerminalSessionResult> {
  attachOwnerCleanup(sender);

  const cols = clampTerminalColumns(input.cols, 120);
  const rows = clampTerminalRows(input.rows, 30);
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
  const aiTurnId = isAiSession ? input.aiTurnId?.trim() || null : null;
  const reusedSession = reuseExistingSession({
    aiTurnId,
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

  const { ptyProcess, shellLabel } = spawnResolvedTerminalShell({
    cols,
    cwd,
    env: terminalEnvironment,
    rows,
  });

  const sessionId = getNextSessionId();

  const activeSession: ActiveTerminalSession = {
    aiTurnId,
    capturePendingAiOutput: input.capturePendingAiOutput ?? isAiSession,
    cwd,
    exitCode: null,
    hasExited: false,
    isAiSession,
    label: input.label ?? null,
    outputBuffer: "",
    pendingAiOutputChunks: [],
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
  input: InternalCreateTerminalSessionInput,
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
  const cols = clampTerminalColumns(input.cols, activeSession.ptyProcess.cols);
  const rows = clampTerminalRows(input.rows, activeSession.ptyProcess.rows);
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
  await terminateSession(input.sessionId);
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
  await waitForTerminalSessionExitOrTimeout(
    activeSession,
    clampTerminalPollingMs(input.pollingMs),
  );
  const refreshedSession = sessions.get(input.sessionId);
  if (!refreshedSession) {
    throw new Error(`Unknown terminal session id: ${input.sessionId}`);
  }

  if (refreshedSession.ownerWebContentsId !== sender.id) {
    throw new Error(
      `Terminal session ${input.sessionId} does not belong to this window.`,
    );
  }

  return createTerminalSessionSnapshot(input.sessionId, refreshedSession);
}

export function consumeTerminalSessionOutputForWebContents(
  sender: WebContents,
  input: TerminalSessionOutputInput,
) {
  const activeSession = assertSessionOwnershipForRead(
    sender.id,
    input.sessionId,
    input.workspaceRootPath,
  );
  consumePendingAiOutput(activeSession, input.pendingOutputLengthToConsume);
}

export function listSessionsForWebContents(
  sender: WebContents,
  workspaceRootPath: string,
): TerminalSessionInfo[] {
  const ownerSessions = getSessionIdsForOwner(sender.id);
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
      sessionId,
      shellLabel: session.shellLabel,
      workspaceRootPath: session.workspaceRootPath,
    });
  }

  return result;
}

export async function terminateSessionForWebContents(
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
  return terminateSession(sessionId);
}

export async function terminateAiSessionsForTurnForWebContents(
  sender: WebContents,
  aiTurnId: string,
  workspaceRootPath: string,
) {
  await terminateAiSessionsForTurn(sender.id, aiTurnId, workspaceRootPath);
}

export async function openExternalTerminalLink(
  input: OpenExternalTerminalLinkInput,
) {
  const safeUrl = parseExternalTerminalLink(input.url);
  await openExternalWithElectronShell(safeUrl);
}

export async function closeAllTerminalSessionsForWebContents(sender: WebContents) {
  const sessionIds = getSessionIdsForOwner(sender.id);
  if (!sessionIds) {
    return;
  }

  await Promise.allSettled(Array.from(sessionIds, (sessionId) => terminateSession(sessionId)));
}

export async function closeAllTerminalSessions() {
  const sessionIds = Array.from(sessions.keys());
  await Promise.allSettled(sessionIds.map((sessionId) => terminateSession(sessionId)));
}
