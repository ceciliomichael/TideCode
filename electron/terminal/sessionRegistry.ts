import { spawnSync } from "node:child_process";
import type { WebContents } from "electron";
import type { IPty } from "node-pty";
import { normalizeWorkspacePath } from "../workspace/paths";
import {
  notifySessionWaiters,
  type ActiveTerminalSession,
} from "./sessionModel";

export type { TerminalSessionInfo, TerminalSessionSnapshot } from "./sessionModel";

export const sessions = new Map<number, ActiveTerminalSession>();
const ownerSessionIds = new Map<number, Set<number>>();
const ownerWorkspaceSessions = new Map<number, Map<string, number>>();
const ownersWithCleanup = new Set<number>();

let nextGlobalSessionId = 1;

export function getSessionIdsForOwner(ownerWebContentsId: number) {
  return ownerSessionIds.get(ownerWebContentsId) ?? null;
}

export function terminateAiSessionsForTurn(
  ownerWebContentsId: number,
  aiTurnId: string,
  workspaceRootPath?: string | null,
) {
  const normalizedAiTurnId = aiTurnId.trim();
  if (!normalizedAiTurnId) {
    return;
  }

  const normalizedWorkspaceRootPath = workspaceRootPath?.trim()
    ? normalizeWorkspacePath(workspaceRootPath)
    : null;
  const sessionIds = Array.from(sessions.entries())
    .filter(([, activeSession]) =>
      activeSession.ownerWebContentsId === ownerWebContentsId &&
      activeSession.isAiSession &&
      activeSession.aiTurnId === normalizedAiTurnId &&
      (!normalizedWorkspaceRootPath || activeSession.workspaceRootPath === normalizedWorkspaceRootPath),
    )
    .map(([sessionId]) => sessionId);

  for (const sessionId of sessionIds) {
    terminateSession(sessionId);
  }
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
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        // Electron is a GUI process on Windows. Without windowsHide, taskkill.exe
        // can briefly create a real console window while an AI PTY is cleaned up.
        windowsHide: true,
      });
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
