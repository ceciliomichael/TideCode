import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  assertTerminalOwner,
  buildTerminalCommandSummary,
  clampInteger,
  createSuccessResult,
  createTerminalErrorResult,
  encodeTerminalInput,
  getOrCreateThreadStore,
  getThreadSession,
  raceWithAbort,
  syncTerminalSessionOutput,
  throwIfAborted,
  type TerminalToolRuntime,
} from "./terminalToolShared";

interface InteractTerminalInput {
  cols?: number;
  keys?: string[];
  rows?: number;
  session_id?: number;
  text?: string;
}

export function createInteractTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Send literal text or control keys to a running terminal session, optionally resize it, and return immediately with an explicit interaction acknowledgement. Use read_terminal afterward to verify completion or detect the next interaction prompt.",
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

        await syncTerminalSessionOutput(
          runtime,
          session,
          dependencies,
          abortSignal,
          0,
        );
        const summary = buildTerminalCommandSummary(session, { includeScreen: true });
        const inputSent = encodedInput.length > 0;
        const interactionSummary = summary.state === "completed"
          ? `Interacted with terminal session ${session.localSessionId}; command completed`
          : summary.state === "needs_interaction"
            ? `Interacted with terminal session ${session.localSessionId}; more input required`
            : `Interacted with terminal session ${session.localSessionId}; read_terminal for status`;

        return createSuccessResult({
          body: [
            "interaction_applied: true",
            `input_sent: ${inputSent}`,
            summary.body,
          ].join("\n"),
          displayBody: summary.state === "running"
            ? inputSent
              ? "Terminal input sent. Read terminal for updates."
              : "Terminal interaction applied. Read terminal for updates."
            : inputSent
              ? `Terminal input sent. ${summary.displayBody}`
              : `Terminal interaction applied. ${summary.displayBody}`,
          semantics: {
            ...summary.semantics,
            input_sent: inputSent,
            interaction_applied: true,
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: interactionSummary,
          truncated: summary.truncated,
        });
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
