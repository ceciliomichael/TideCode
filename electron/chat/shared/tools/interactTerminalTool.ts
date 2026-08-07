import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  assertTerminalOwner,
  buildTerminalCommandSummary,
  clampInteger,
  createSuccessResult,
  createTerminalCommandResult,
  createTerminalErrorResult,
  encodeTerminalInput,
  getOrCreateThreadStore,
  getThreadSession,
  raceWithAbort,
  removeThreadSession,
  throwIfAborted,
  waitForTerminalCommand,
  type TerminalToolRuntime,
} from "./terminalToolShared";

interface InteractTerminalInput {
  cols?: number;
  keys?: string[];
  rows?: number;
  session_id?: number;
  terminate?: boolean;
  text?: string;
}

export function createInteractTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Send input or control keys to a terminal session, resize it, or terminate it. Waits until the command completes or needs more input; screen-based sessions include their updated visible screen when they remain interactive.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        cols: {
          maximum: 400,
          minimum: 20,
          type: "number",
        },
        keys: {
          description: "Named keys such as ENTER, CTRL_C, TAB, UP, or a single printable key.",
          items: {
            maxLength: 32,
            type: "string",
          },
          maxItems: 100,
          type: "array",
        },
        rows: {
          maximum: 200,
          minimum: 6,
          type: "number",
        },
        session_id: {
          description: "Terminal session to control.",
          type: "number",
        },
        terminate: {
          description: "Terminate the terminal session instead of sending input.",
          type: "boolean",
        },
        text: {
          description: "Literal text to send to the terminal.",
          type: "string",
        },
      },
      required: ["session_id"],
      type: "object",
    }),
    execute: async (rawInput, options): Promise<AgentToolExecutionResult> => {
      const input = rawInput as InteractTerminalInput;
      const abortSignal = options?.abortSignal;

      try {
        assertTerminalOwner(runtime);
        const dependencies = await runtime.getDependencies();
        const store = getOrCreateThreadStore(runtime.namespace);
        if (typeof input.session_id !== "number") {
          return createTerminalErrorResult("session_id is required.");
        }

        const session = getThreadSession(store, input.session_id);
        if (!session) {
          return createTerminalErrorResult(
            `Terminal session ${input.session_id} was not found in this chat turn.`,
            "The terminal session is no longer available.",
          );
        }

        if (input.terminate) {
          dependencies.terminateSession(
            runtime.ownerWebContents,
            session.globalSessionId,
            runtime.context.workspaceRootPath,
          );
          removeThreadSession(store, session.localSessionId);
          return createSuccessResult({
            body: `Terminal session ${session.localSessionId} terminated.`,
            displayBody: "Terminal session terminated.",
            semantics: {
              session_id: session.localSessionId,
              state: "terminated",
            },
            subject: { kind: "session", path: String(session.localSessionId) },
            summary: `Terminated terminal session ${session.localSessionId}`,
          });
        }

        if (session.commandComplete) {
          return createTerminalErrorResult(
            `Terminal session ${session.localSessionId} has no running command. Use execute_terminal to run another command.`,
            "This terminal command has already finished. Use execute_terminal to run another command.",
          );
        }

        const keys = Array.isArray(input.keys)
          ? input.keys.filter((key): key is string => typeof key === "string")
          : [];
        const encodedInput = encodeTerminalInput(input.text, keys);
        const cols = input.cols === undefined ? null : clampInteger(input.cols, 20, 400, 220);
        const rows = input.rows === undefined ? null : clampInteger(input.rows, 6, 200, 50);

        throwIfAborted(abortSignal);
        if (cols !== null || rows !== null) {
          await raceWithAbort(
            dependencies.resizeSession(runtime.ownerWebContents, {
              cols: cols ?? session.screen.getSnapshot().cols,
              rows: rows ?? session.screen.getSnapshot().rows,
              sessionId: session.globalSessionId,
              workspaceRootPath: runtime.context.workspaceRootPath,
            }),
            abortSignal,
          );
          const currentScreen = session.screen.getSnapshot();
          session.screen.resize(cols ?? currentScreen.cols, rows ?? currentScreen.rows);
        }

        if (encodedInput.length > 0) {
          session.interaction = null;
          session.detector.reset();
          await raceWithAbort(
            dependencies.writeToSession(runtime.ownerWebContents, {
              data: encodedInput,
              sessionId: session.globalSessionId,
              workspaceRootPath: runtime.context.workspaceRootPath,
            }),
            abortSignal,
          );
        }

        await waitForTerminalCommand(runtime, session, dependencies, abortSignal);
        const summary = buildTerminalCommandSummary(session, { includeScreen: true });
        return createTerminalCommandResult(session, summary);
      } catch (error) {
        if (abortSignal?.aborted) {
          throw error;
        }
        return createTerminalErrorResult(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Terminal interaction failed.",
        );
      }
    },
  });
}
