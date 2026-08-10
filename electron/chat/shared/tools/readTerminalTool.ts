import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  assertTerminalOwner,
  buildTerminalCommandSummary,
  clampInteger,
  createSuccessResult,
  createTerminalErrorResult,
  drainUnreadTerminalOutput,
  getOrCreateThreadStore,
  getThreadSession,
  syncTerminalSessionOutput,
  type TerminalToolRuntime,
} from "./terminalToolShared";

const DEFAULT_WAIT_SECONDS = 15;
const MAX_WAIT_SECONDS = 15;

interface ReadTerminalInput {
  session_id?: number;
  wait_seconds?: number;
}

function getWaitMilliseconds(value: number | undefined) {
  return clampInteger(value, 0, MAX_WAIT_SECONDS, DEFAULT_WAIT_SECONDS) * 1_000;
}

export function createReadTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Wait up to wait_seconds for a terminal session, then consume and return only output produced since the previous read. Repeated calls never replay already-returned output. The wait is bounded to 15 seconds and returns early when the command finishes.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        session_id: {
          description: "Terminal session returned by execute_terminal.",
          type: "number",
        },
        wait_seconds: {
          default: DEFAULT_WAIT_SECONDS,
          description: "Maximum collection window in seconds. Use 0 for an immediate non-blocking read.",
          maximum: MAX_WAIT_SECONDS,
          minimum: 0,
          type: "number",
        },
      },
      required: ["session_id"],
      type: "object",
    }),
    execute: async (rawInput, options): Promise<AgentToolExecutionResult> => {
      const input = rawInput as ReadTerminalInput;
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

        const waitMilliseconds = session.commandComplete ? 0 : getWaitMilliseconds(input.wait_seconds);
        const deadline = Date.now() + waitMilliseconds;
        do {
          const remainingMilliseconds = Math.max(0, deadline - Date.now());
          await syncTerminalSessionOutput(
            runtime,
            session,
            dependencies,
            abortSignal,
            remainingMilliseconds,
          );
          if (session.commandComplete || session.interaction || remainingMilliseconds === 0) {
            break;
          }
        } while (Date.now() < deadline);

        const unreadOutput = drainUnreadTerminalOutput(session);
        const commandSummary = buildTerminalCommandSummary(session);
        const bodyLines = [`state: ${commandSummary.state}`];
        if (commandSummary.state === "completed" && session.commandExitCode !== null && session.commandExitCode !== 0) {
          bodyLines.push("result: failed");
        }
        if (unreadOutput.lines.length > 0) {
          bodyLines.push(
            "",
            "new_output:",
            ...unreadOutput.lines.map((line) => `${line.lineNumber}: ${line.text}`),
          );
        } else {
          bodyLines.push("", "No new terminal output.");
        }

        return createSuccessResult({
          body: bodyLines.join("\n"),
          displayBody:
            unreadOutput.lines.length > 0
              ? unreadOutput.lines.map((line) => line.text).join("\n")
              : commandSummary.displayBody,
          semantics: {
            ...commandSummary.semantics,
            new_output_line_count: unreadOutput.lines.length,
            next_unread_line: session.nextUnreadLine,
            wait_seconds: waitMilliseconds / 1_000,
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: commandSummary.state === "completed"
            ? `Read completed terminal session ${session.localSessionId}`
            : `Read new output from terminal session ${session.localSessionId}`,
          truncated: unreadOutput.skippedEvictedLines,
        });
      } catch (error) {
        if (abortSignal?.aborted) {
          throw error;
        }
        return createTerminalErrorResult(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Terminal output read failed.",
        );
      }
    },
  });
}
