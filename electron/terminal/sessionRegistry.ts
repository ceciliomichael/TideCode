import { spawnSync } from "node:child_process";
import type { WebContents } from "electron";
import type { IPty } from "node-pty";
import { normalizeWorkspacePath } from "../workspace/paths";
import {
  notifySessionWaiters,
  type ActiveTerminalSession,
} from "./sessionModel";

const IDLE_TERMINATE_MS = 5 * 60 * 1000; // 5 minutes

export type { TerminalSessionInfo, TerminalSessionSnapshot } from "./sessionModel";

export const sessions = new Map<number, ActiveTerminalSession>();
const ownerSessionIds = new Map<number, Set<number>>();
const ownerWorkspaceSessions = new Map<number, Map<string, number>>();
const ownersWithCleanup = new Set<number>();

let nextGlobalSessionId = 1;

export function getSessionIdsForOwner(ownerWebContentsId: number) {
  return ownerSessionIds.get(ownerWebContentsId) ?? null;
}

export function getNextSessionId() {
  return nextGlobalSessionId++;
}


export function registerSessionWithOwner(
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

export function registerWorkspaceSession(
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

export function unregisterWorkspaceSession(
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

export function findWorkspaceSessionId(
  ownerWebContentsId: number,
  workspaceKey: string,
) {
  const ownerMappings = ownerWorkspaceSessions.get(ownerWebContentsId);
  return ownerMappings?.get(workspaceKey) ?? null;
}

export function terminateSession(sessionId: number) {
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

export function scheduleIdleTerminate(sessionId: number) {
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

export function attachOwnerCleanup(sender: WebContents) {
  if (ownersWithCleanup.has(sender.id)) {
    return;
  }

  ownersWithCleanup.add(sender.id);
  sender.once("destroyed", () => {
    ownersWithCleanup.delete(sender.id);
    terminateSessionsForOwner(sender.id);
  });
}

export function assertSessionOwnership(
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

export function assertSessionOwnershipForRead(
  ownerWebContentsId: number,
  sessionId: number,
  workspaceRootPath?: string | null,
) {
  return assertSessionOwnership(ownerWebContentsId, sessionId, workspaceRootPath);
}
