import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  assertTerminalOwner,
  buildTerminalCommandSummary,
  createSuccessResult,
  createTerminalErrorResult,
  getOrCreateThreadStore,
  getThreadSession,
  syncTerminalSessionOutput,
  type TerminalToolRuntime,
} from "./terminalToolShared";
import { formatTerminalScreenForModel } from "../../../terminal/screenModel";

const DEFAULT_READ_LIMIT = 100;
const MAX_READ_LIMIT = 200;

interface ReadTerminalInput {
  limit?: number;
  offset?: number;
  session_id?: number;
}

function clampReadValue(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

export function createReadTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Read terminal content. For an interactive screen, returns the current visible screen as a user would see it; otherwise returns a bounded normalized line range. Terminal commands return metadata first; use this tool when content is needed.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        limit: {
          description: "Maximum number of normalized terminal lines to return.",
          maximum: MAX_READ_LIMIT,
          minimum: 1,
          type: "number",
        },
        offset: {
          description: "One-based first normalized terminal line to return.",
          minimum: 1,
          type: "number",
        },
        session_id: {
          description: "Terminal session to read.",
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

        await syncTerminalSessionOutput(runtime, session, dependencies, abortSignal, 0);
        const commandSummary = buildTerminalCommandSummary(session);
        if (session.interaction?.kind === "screen") {
          const screenSnapshot = session.screen.getSnapshot();
          return createSuccessResult({
            body: formatTerminalScreenForModel(screenSnapshot),
            semantics: {
              active_buffer: screenSnapshot.activeBuffer,
              cursor_column: screenSnapshot.cursorColumn,
              cursor_row: screenSnapshot.cursorRow,
              session_id: session.localSessionId,
              state: commandSummary.state,
              view: "screen",
            },
            subject: { kind: "session", path: String(session.localSessionId) },
            summary: `Read terminal session ${session.localSessionId} screen`,
          });
        }

        const offset = clampReadValue(input.offset, 1);
        const limit = Math.min(clampReadValue(input.limit, DEFAULT_READ_LIMIT), MAX_READ_LIMIT);
        const readResult = session.transcript.read(offset, limit);
        const bodyLines = readResult.lines.map((line) => `${line.lineNumber}: ${line.text}`);

        if (readResult.skippedEvictedLines) {
          bodyLines.unshift(
            `(Earlier output is no longer retained. Showing from line ${readResult.summary.firstAvailableLine}.)`,
          );
        }

        if (bodyLines.length === 0) {
          bodyLines.push("No terminal output is available in the requested range.");
        }

        const responseTruncated =
          commandSummary.truncated || readResult.hasMore || readResult.skippedEvictedLines;
        return createSuccessResult({
          body: bodyLines.join("\n"),
          semantics: {
            ...commandSummary.semantics,
            has_more: readResult.hasMore,
            limit,
            offset,
            returned_line_count: readResult.lines.length,
            skipped_evicted_lines: readResult.skippedEvictedLines,
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: `Read terminal session ${session.localSessionId} lines ${offset}-${offset + limit - 1}`,
          truncated: responseTruncated,
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
