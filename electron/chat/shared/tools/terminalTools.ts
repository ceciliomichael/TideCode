import type { WebContents } from "electron";
import type { AgentToolContext } from "../toolTypes";
import { createExecuteTerminalTool } from "./executeTerminalTool";
import { createReadTerminalTool } from "./readTerminalTool";
import { createTerminateTerminalTool } from "./terminateTerminalTool";
import {
  createTerminalToolRuntime,
  terminateAllBackgroundSessions as terminateSessions,
  terminateAllBackgroundSessionsForTurn as terminateSessionsForTurn,
  type TerminalToolDependencies,
} from "./terminalToolShared";

export type { TerminalToolDependencies } from "./terminalToolShared";

export function createTerminalToolSet(
  context: AgentToolContext,
  dependencies: Partial<TerminalToolDependencies> = {},
) {
  const runtime = createTerminalToolRuntime(context, dependencies);
  return {
    execute_terminal: createExecuteTerminalTool(runtime),
    read_terminal: createReadTerminalTool(runtime),
    terminate_terminal: createTerminateTerminalTool(runtime),
  };
}

export async function terminateAllBackgroundSessions(
  webContents: WebContents,
  workspaceRootPath: string,
  conversationIdOrTerminate?: string | null | ((
    webContents: WebContents,
    sessionId: number,
    workspaceRootPath: string,
  ) => void),
  customTerminateSession?: (
    webContents: WebContents,
    sessionId: number,
    workspaceRootPath: string,
  ) => void,
) {
  return terminateSessions(
    webContents,
    workspaceRootPath,
    conversationIdOrTerminate,
    customTerminateSession,
  );
}

export async function terminateAllBackgroundSessionsForTurn(
  webContents: WebContents,
  workspaceRootPath: string,
  turnId: string,
  customTerminateSession?: (
    webContents: WebContents,
    sessionId: number,
    workspaceRootPath: string,
  ) => void,
) {
  return terminateSessionsForTurn(
    webContents,
    workspaceRootPath,
    turnId,
    customTerminateSession,
  );
}
