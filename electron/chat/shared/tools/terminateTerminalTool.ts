import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  assertTerminalOwner,
  createSuccessResult,
  createTerminalErrorResult,
  getOrCreateThreadStore,
  getThreadSession,
  removeThreadSession,
  type TerminalToolRuntime,
} from "./terminalToolShared";

interface TerminateTerminalInput {
  session_id?: number;
}

export function createTerminateTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Terminate an existing broker-owned terminal session early and retain its final lifecycle record.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        session_id: {
          description: "Terminal session returned by execute_terminal.",
          type: "number",
        },
      },
      required: ["session_id"],
      type: "object",
    }),
    execute: async (rawInput): Promise<AgentToolExecutionResult> => {
      const input = rawInput as TerminateTerminalInput;

      try {
        assertTerminalOwner(runtime);
        if (typeof input.session_id !== "number") {
          return createTerminalErrorResult("session_id is required.");
        }

        const store = getOrCreateThreadStore(runtime.namespace);
        const session = getThreadSession(store, input.session_id);
        if (!session) {
          return createTerminalErrorResult(
            `Terminal session ${input.session_id} was not found in this chat turn.`,
            "The terminal session is no longer available.",
          );
        }

        const dependencies = await runtime.getDependencies();
        dependencies.terminateSession(
          runtime.ownerWebContents,
          session.globalSessionId,
          runtime.context.workspaceRootPath,
        );
        removeThreadSession(store, session.localSessionId);

        return createSuccessResult({
          body: `session_id: ${session.localSessionId}\nstate: terminated`,
          displayBody: "Terminal session terminated.",
          semantics: {
            session_id: session.localSessionId,
            state: "terminated",
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: `Terminated terminal session ${session.localSessionId}`,
        });
      } catch (error) {
        return createTerminalErrorResult(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Terminal termination failed.",
        );
      }
    },
  });
}
