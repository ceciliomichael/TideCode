import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  assertTerminalOwner,
  buildTerminalCommandSummary,
  clampInteger,
  createSuccessResult,
  createTerminalErrorResult,
  drainUnreadTerminalOutput,
  encodeTerminalInput,
  getOrCreateThreadStore,
  getRecentTranscriptTail,
  getThreadSession,
  MAX_TERMINAL_WAIT_SECONDS,
  raceWithAbort,
  syncTerminalSessionOutput,
  throwIfAborted,
  type TerminalToolRuntime,
} from "./terminalToolShared";

const DEFAULT_READ_WAIT_SECONDS = 15;

interface InteractTerminalInput {
  cols?: number;
  keys?: string[];
  rows?: number;
  session_id?: number;
  text?: string;
  wait_seconds?: number;
}

export function createInteractTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Control an active terminal session: wait for/read new output, type text/prompts into stdin, or send control keys like CTRL_C to stop the process. Omit text and keys for a pure read.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        cols: {
          description: "Optional. Terminal column width.",
          maximum: 400,
          minimum: 20,
          type: "number",
        },
        keys: {
          description: "Optional named control keys to send: ENTER, CTRL_C, CTRL_D, TAB, ESC, UP, DOWN, LEFT, RIGHT.",
          items: {
            maxLength: 32,
            type: "string",
          },
          maxItems: 100,
          type: "array",
        },
        rows: {
          description: "Optional. Terminal row height.",
          maximum: 200,
          minimum: 6,
          type: "number",
        },
        session_id: {
          description: "Terminal session ID returned by execute_terminal.",
          type: "number",
        },
        text: {
          description: "Literal text or characters to send to the running process (e.g. 'yes\\n' or '\\u0003' for Ctrl+C).",
          type: "string",
        },
        wait_seconds: {
          description: "Optional collection window in seconds to wait for output. Defaults to 15s for pure reads. Use 0 for an immediate non-blocking read.",
          minimum: 0,
          type: "number",
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

        const keys = Array.isArray(input.keys)
          ? input.keys.filter((key): key is string => typeof key === "string")
          : [];
        const encodedInput = encodeTerminalInput(input.text, keys);
        const inputSent = encodedInput.length > 0;
        const isPureRead = !inputSent;

        if (session.commandComplete && inputSent) {
          return createTerminalErrorResult(
            `Terminal session ${session.localSessionId} has already completed. Use execute_terminal to start another command.`,
            "This terminal command has already finished. Use execute_terminal to run another command.",
          );
        }

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

        if (inputSent) {
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

        const defaultWait = isPureRead ? DEFAULT_READ_WAIT_SECONDS : 0;
        const requestedWait = typeof input.wait_seconds === "number" ? input.wait_seconds : defaultWait;
        const waitMilliseconds = session.commandComplete
          ? 0
          : clampInteger(requestedWait, 0, MAX_TERMINAL_WAIT_SECONDS, defaultWait) * 1_000;

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
        const summary = buildTerminalCommandSummary(session, { includeScreen: true });
        const transcriptSummary = session.transcript.getSummary();
        const rawOutputText = unreadOutput.lines.map((line) => line.text).join("\n");

        const status = summary.state === "running"
          ? session.isDaemon
            ? "daemon_listening"
            : "actively_executing"
          : summary.state === "needs_interaction"
            ? "waiting_for_input"
            : session.commandExitCode !== null && session.commandExitCode !== 0
              ? "failed"
              : "completed";

        const bodyLines: string[] = [
          `session_id: ${session.localSessionId}`,
          `state: ${summary.state}`,
          `status: ${status}`,
        ];

        if (inputSent) {
          bodyLines.push("interaction_applied: true", `input_sent: true`);
        }

        if (summary.state === "completed" && session.commandExitCode !== null && session.commandExitCode !== 0) {
          bodyLines.push("result: failed");
        }

        if (unreadOutput.lines.length > 0) {
          bodyLines.push(
            `new_output_lines: ${unreadOutput.lines.length}`,
            `total_output_lines: ${transcriptSummary.lineCount}`,
            "",
            "new_output:",
            ...unreadOutput.lines.map((line) => `${line.lineNumber}: ${line.text}`),
          );
          if (summary.state === "running") {
            if (session.isDaemon) {
              bodyLines.push(
                "",
                "guidance: Web server or watcher is running and listening. Do not wait in a polling loop; proceed with your tasks or send Ctrl+C to stop it.",
              );
            } else {
              bodyLines.push(
                "",
                "guidance: Command is actively executing in the background. Call interact_terminal again to continue waiting for output or completion.",
              );
            }
          }
        } else {
          if (summary.state === "running") {
            bodyLines.push(
              `waited_seconds: ${waitMilliseconds / 1_000}`,
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
                "guidance: Process is actively executing in background and has not exited. Use interact_terminal to wait for output or send Ctrl+C to cancel. Do not re-run this command while the session is active.",
              );
            }
          } else {
            bodyLines.push("", "No new terminal output.");
          }
        }

        const displayBody = unreadOutput.lines.length > 0
          ? rawOutputText
          : summary.state === "needs_interaction"
            ? summary.displayBody
            : summary.state === "completed" && session.commandExitCode !== null && session.commandExitCode !== 0
              ? "Terminal command failed."
              : inputSent
                ? "Terminal input sent."
                : "";

        const interactionSummary = summary.state === "completed"
          ? `Terminal session ${session.localSessionId} completed`
          : summary.state === "needs_interaction"
            ? `Terminal session ${session.localSessionId} waiting for input`
            : inputSent
              ? `Sent input to terminal session ${session.localSessionId}`
              : `Read output from terminal session ${session.localSessionId}`;

        return createSuccessResult({
          body: bodyLines.join("\n"),
          displayBody,
          semantics: {
            ...summary.semantics,
            active: summary.state === "running",
            input_sent: inputSent,
            interaction_applied: inputSent,
            is_daemon: session.isDaemon,
            new_output_line_count: unreadOutput.lines.length,
            next_unread_line: session.nextUnreadLine,
            output_evicted: unreadOutput.skippedEvictedLines,
            session_id: session.localSessionId,
            state: summary.state,
            status,
            total_output_lines: transcriptSummary.lineCount,
            wait_seconds: waitMilliseconds / 1_000,
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: interactionSummary,
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
