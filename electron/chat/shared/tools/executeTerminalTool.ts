import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import { WORKSPACE_PATH_DESCRIPTION } from "./workspaceToolPaths";
import {
  allocateVisibleSessionId,
  assertSandboxCommand,
  assertTerminalOwner,
  buildMarkedCommand,
  buildTerminalCommandSummary,
  clampInteger,
  createCompletionMarker,
  createSuccessResult,
  createTerminalErrorResult,
  createThreadAiSession,
  drainUnreadTerminalOutput,
  getOrCreateThreadStore,
  MAX_TERMINAL_WAIT_SECONDS,
  normalizeCommand,
  prepareTerminalCommand,
  raceWithAbort,
  removeThreadSession,
  resetThreadSessionForCommand,
  resolveTerminalWorkspaceCwd,
  syncTerminalSessionOutput,
  throwIfAborted,
  type TerminalToolRuntime,
} from "./terminalToolShared";

interface ExecuteTerminalInput {
  command?: string;
  cwd?: string;
  wait_seconds?: number;
}

export function createExecuteTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Start a terminal command asynchronously and return its session_id immediately (or wait up to wait_seconds for output if specified). Use read_terminal to wait for or consume additional output.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        command: {
          description: "Command to run.",
          type: "string",
        },
        cwd: {
          description: `${WORKSPACE_PATH_DESCRIPTION} Omit to start at the workspace root.`,
          type: "string",
        },
        wait_seconds: {
          description: "Optional. Maximum collection window in seconds to wait for initial output. Omit or set to 0 for an immediate non-blocking start.",
          minimum: 0,
          type: "number",
        },
      },
      required: ["command"],
      type: "object",
    }),
    execute: async (rawInput, options): Promise<AgentToolExecutionResult> => {
      const input = rawInput as ExecuteTerminalInput;
      const abortSignal = options?.abortSignal;
      let createdSession = false;
      let localSessionId: number | null = null;
      let globalSessionId: number | null = null;
      let storeForCleanup: ReturnType<typeof getOrCreateThreadStore> | null = null;

      try {
        assertTerminalOwner(runtime);
        const dependencies = await runtime.getDependencies();
        const store = getOrCreateThreadStore(runtime.namespace);
        storeForCleanup = store;
        const requestedCommand = normalizeCommand(input.command);
        if (!requestedCommand) {
          return createTerminalErrorResult("command is required.");
        }

        const command = prepareTerminalCommand(requestedCommand);
        const resolvedCwd = resolveTerminalWorkspaceCwd(runtime.context, input.cwd);
        const cwd = resolvedCwd.absolutePath;
        await assertSandboxCommand(runtime, command, cwd, resolvedCwd.roots);

        const cols = clampInteger(undefined, 20, 400, 220);
        const rows = clampInteger(undefined, 6, 200, 50);
        localSessionId = allocateVisibleSessionId(store);
        const marker = createCompletionMarker(localSessionId);
        const aiSessionKey = `__ai__${runtime.namespace}__${localSessionId}`;
        let session: ReturnType<typeof createThreadAiSession> | null = null;
        try {
          const created = await raceWithAbort(
            dependencies.createSession(runtime.ownerWebContents, {
              aiTurnId: runtime.context.turnId?.trim() || null,
              cols,
              cwd,
              isAiSession: true,
              label: null,
              rows,
              sessionKey: aiSessionKey,
              workspaceRootPath: runtime.context.workspaceRootPath,
            }),
            abortSignal,
          );
          globalSessionId = created.sessionId;
          session = createThreadAiSession({
            cols,
            command,
            cwd: created.cwd,
            globalSessionId: created.sessionId,
            interactionMode: "auto",
            label: null,
            localSessionId,
            marker,
            rows,
            shell: created.shell,
          });
          store.sessions.set(localSessionId, session);
          createdSession = true;
        } catch (error) {
          store.reservedSessionIds.delete(localSessionId);
          throw error;
        }

        if (!session || globalSessionId === null || localSessionId === null) {
          throw new Error("Unable to prepare the terminal session.");
        }

        resetThreadSessionForCommand(session, command, marker, "auto");
        store.latestLocalSessionId = localSessionId;

        throwIfAborted(abortSignal);
        await raceWithAbort(
          dependencies.writeToSession(runtime.ownerWebContents, {
            data: buildMarkedCommand(command, session.shell, marker),
            sessionId: globalSessionId,
            workspaceRootPath: runtime.context.workspaceRootPath,
          }),
          abortSignal,
        );

        let unreadOutput: ReturnType<typeof drainUnreadTerminalOutput> | null = null;
        let unreadOutputLines: string[] = [];
        let commandState = "running";

        if (typeof input.wait_seconds === "number" && input.wait_seconds > 0) {
          const waitMs = clampInteger(input.wait_seconds, 0, MAX_TERMINAL_WAIT_SECONDS, 0) * 1_000;
          const deadline = Date.now() + waitMs;
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

          unreadOutput = drainUnreadTerminalOutput(session);
          const commandSummary = buildTerminalCommandSummary(session);
          commandState = commandSummary.state;
          unreadOutputLines = unreadOutput.lines.map((line) => `${line.lineNumber}: ${line.text}`);
        }

        const status = commandState === "running"
          ? session.isDaemon
            ? "daemon_listening"
            : "actively_executing"
          : commandState === "needs_interaction"
            ? "waiting_for_input"
            : session.commandExitCode !== null && session.commandExitCode !== 0
              ? "failed"
              : "completed";

        const bodyLines = [
          `session_id: ${session.localSessionId}`,
          `state: ${commandState}`,
          `status: ${status}`,
        ];

        if (commandState === "completed" && session.commandExitCode !== null && session.commandExitCode !== 0) {
          bodyLines.push("result: failed");
        }

        if (unreadOutputLines.length > 0) {
          bodyLines.push(
            `new_output_lines: ${unreadOutputLines.length}`,
            "",
            "new_output:",
            ...unreadOutputLines,
          );
          if (commandState === "running") {
            if (session.isDaemon) {
              bodyLines.push(
                "",
                "guidance: Web server or background watcher started and is listening on port. Do not wait in a polling loop; proceed with tasks or send Ctrl+C using interact_terminal when finished.",
              );
            } else {
              bodyLines.push(
                "",
                "guidance: Command is actively executing in the background. Use interact_terminal to wait for output, send input, or stop it with Ctrl+C.",
              );
            }
          }
        } else if (commandState === "running") {
          if (session.isDaemon) {
            bodyLines.push(
              "",
              "guidance: Web server started and is listening in background. Do not poll in a loop; proceed with next steps or send Ctrl+C via interact_terminal to stop it.",
            );
          } else {
            bodyLines.push(
              "",
              "guidance: Command started and is actively executing in the background. Call interact_terminal with session_id to wait for output or send Ctrl+C. Do not re-run the command.",
            );
          }
        }

        const displayBody = unreadOutput && unreadOutput.lines.length > 0
          ? unreadOutput.lines.map((line) => line.text).join("\n")
          : commandState === "needs_interaction"
            ? "Waiting for terminal input."
            : commandState === "completed" && session.commandExitCode !== null && session.commandExitCode !== 0
              ? "Terminal command failed."
              : "";

        return createSuccessResult({
          body: bodyLines.join("\n"),
          displayBody,
          semantics: {
            active: commandState === "running",
            new_output_line_count: unreadOutputLines.length,
            session_id: session.localSessionId,
            state: commandState,
            status,
            wait_seconds: typeof input.wait_seconds === "number" && input.wait_seconds > 0
              ? clampInteger(input.wait_seconds, 0, MAX_TERMINAL_WAIT_SECONDS, 0)
              : 0,
          },
          subject: { kind: "session", path: String(session.localSessionId) },
          summary: `Started terminal session ${session.localSessionId}`,
        });
      } catch (error) {
        if (createdSession && globalSessionId !== null && runtime.ownerWebContents) {
          if (localSessionId !== null && storeForCleanup) {
            removeThreadSession(storeForCleanup, localSessionId);
          }
          try {
            const dependencies = await runtime.getDependencies();
            dependencies.terminateSession(
              runtime.ownerWebContents,
              globalSessionId,
              runtime.context.workspaceRootPath,
            );
          } catch {
            // Turn cleanup performs another best-effort termination attempt.
          }
        }

        if (abortSignal?.aborted) {
          throw error;
        }
        return createTerminalErrorResult(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Terminal command failed to start.",
        );
      }
    },
  });
}
