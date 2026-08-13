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
          maximum: 15,
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

        let unreadOutputLines: string[] = [];
        let commandState = "running";

        if (typeof input.wait_seconds === "number" && input.wait_seconds > 0) {
          const waitMs = clampInteger(input.wait_seconds, 0, 15, 0) * 1_000;
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

          const unreadOutput = drainUnreadTerminalOutput(session);
          const commandSummary = buildTerminalCommandSummary(session);
          commandState = commandSummary.state;
          unreadOutputLines = unreadOutput.lines.map((line) => `${line.lineNumber}: ${line.text}`);
        }

        const bodyLines = [
          `session_id: ${session.localSessionId}`,
          `state: ${commandState}`,
        ];

        if (commandState === "completed" && session.commandExitCode !== null && session.commandExitCode !== 0) {
          bodyLines.push("result: failed");
        }

        if (unreadOutputLines.length > 0) {
          bodyLines.push("", "new_output:", ...unreadOutputLines);
        }

        return createSuccessResult({
          body: bodyLines.join("\n"),
          displayBody: bodyLines.join("\n"),
          semantics: {
            session_id: session.localSessionId,
            state: commandState,
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
