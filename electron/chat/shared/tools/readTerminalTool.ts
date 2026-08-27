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
  getRecentTranscriptTail,
  getThreadSession,
  MAX_TERMINAL_WAIT_SECONDS,
  syncTerminalSessionOutput,
  synchronizeBrokerOperation,
  type TerminalToolRuntime,
} from "./terminalToolShared";

const DEFAULT_WAIT_SECONDS = 15;
const MAX_WAIT_SECONDS = MAX_TERMINAL_WAIT_SECONDS;

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
      "Wait up to wait_seconds for an existing terminal session and return only new output since the previous read. The wait returns early when the command finishes or interactive input is detected. If input is needed, use interact_terminal with this same session_id.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        session_id: {
          description: "Terminal session returned by execute_terminal.",
          type: "number",
        },
        wait_seconds: {
          default: DEFAULT_WAIT_SECONDS,
          description: "Optional. Maximum collection window in seconds to wait for output. Defaults to 15s. Use 0 for an immediate non-blocking read.",
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
        await synchronizeBrokerOperation(session, dependencies);
        const commandSummary = buildTerminalCommandSummary(session);
        const transcriptSummary = session.transcript.getSummary();
        const waitedSeconds = waitMilliseconds / 1_000;

        const status = commandSummary.state === "running"
          ? session.isDaemon
            ? "daemon_listening"
            : "actively_executing"
          : commandSummary.state === "needs_interaction"
            ? "waiting_for_input"
            : "completed";

        const bodyLines: string[] = [
          `session_id: ${session.localSessionId}`,
          `state: ${commandSummary.state}`,
          `status: ${status}`,
        ];

        if (commandSummary.state === "completed" && session.commandExitCode !== null) {
          bodyLines.push(`exit_code: ${session.commandExitCode}`);
        }

        if (unreadOutput.lines.length > 0) {
          bodyLines.push(
            `new_output_lines: ${unreadOutput.lines.length}`,
            `total_output_lines: ${transcriptSummary.lineCount}`,
            "",
            "new_output:",
            ...unreadOutput.lines.map((line) => `${line.lineNumber}: ${line.text}`),
          );
          if (commandSummary.state === "running") {
            if (session.isDaemon) {
              bodyLines.push(
                "",
                "guidance: Web server or watcher is running and listening. Do not wait in a polling loop; proceed with your tasks or send Ctrl+C to stop it.",
              );
            } else {
              bodyLines.push(
                "",
"guidance: Command is still running. Read this same session again when more output is needed. Use interact_terminal only if an input prompt appears or a control key is required.",
              );
            }
          }
        } else {
          if (commandSummary.state === "running") {
            bodyLines.push(
              `waited_seconds: ${waitedSeconds}`,
              `total_output_lines_so_far: ${transcriptSummary.lineCount}`,
              "",
              "No new terminal output was emitted during this collection window.",
            );

            const recentTail = getRecentTranscriptTail(session, 5);
            if (recentTail.length > 0) {
              bodyLines.push(
                "",
                "recent_output_tail:",
                ...recentTail.map((line) => `${line.lineNumber}: ${line.text}`),
              );
            }

            if (session.isDaemon) {
              bodyLines.push(
                "",
                "guidance: Process is an active web server or watcher (listening on port). It will not exit on its own. Do not poll in a loop; proceed with next steps or send Ctrl+C to stop it.",
              );
            } else {
              bodyLines.push(
                "",
"guidance: The command is still running. Keep the same session_id and call read_terminal again later. If the terminal asks for input, answer with interact_terminal on this session instead of re-running the command.",
              );
            }
          } else {
            bodyLines.push("", "No new terminal output.");
          }
        }

        const displayBody = unreadOutput.lines.length > 0
          ? unreadOutput.lines.map((line) => line.text).join("\n")
          : commandSummary.displayBody;

        return createSuccessResult({
          body: bodyLines.join("\n"),
          displayBody,
          semantics: {
            ...commandSummary.semantics,
            active: commandSummary.state === "running",
            broker_session_id: session.brokerSessionId,
            new_output_line_count: unreadOutput.lines.length,
            operation_id: session.brokerOperationId,
            next_unread_line: session.nextUnreadLine,
            output_evicted: unreadOutput.skippedEvictedLines,
            status,
            total_output_lines: transcriptSummary.lineCount,
            wait_seconds: waitedSeconds,
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: commandSummary.state === "completed"
            ? `Read completed terminal session ${session.localSessionId}`
            : `Read output from terminal session ${session.localSessionId}`,
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
