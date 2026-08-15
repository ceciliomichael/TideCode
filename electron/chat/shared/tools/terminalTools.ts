import type { WebContents } from "electron";
import type { AgentToolContext } from "../toolTypes";
import type { ChatStreamEventTarget } from "../runtimeStreamEvents";
import { createExecuteTerminalTool } from "./executeTerminalTool";
import { createInteractTerminalTool } from "./interactTerminalTool";
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
    interact_terminal: createInteractTerminalTool(runtime),
    read_terminal: createReadTerminalTool(runtime),
    terminate_terminal: createTerminateTerminalTool(runtime),
  };
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
  return terminateSessions(
    webContents,
    workspaceRootPath,
    conversationIdOrTerminate,
    customTerminateSession,
  );
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
  return terminateSessionsForTurn(
    webContents,
    workspaceRootPath,
    turnId,
    customTerminateSession,
  );
}
