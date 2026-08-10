import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  allocateVisibleSessionId,
  assertSandboxCommand,
  assertTerminalOwner,
  buildMarkedCommand,
  clampInteger,
  createCompletionMarker,
  createSuccessResult,
  createTerminalErrorResult,
  createThreadAiSession,
  getOrCreateThreadStore,
  normalizeCommand,
  prepareTerminalCommand,
  raceWithAbort,
  removeThreadSession,
  resetThreadSessionForCommand,
  resolveTerminalWorkspaceCwd,
  throwIfAborted,
  type TerminalToolRuntime,
} from "./terminalToolShared";

interface ExecuteTerminalInput {
  command?: string;
  cwd?: string;
}

export function createExecuteTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Start a terminal command asynchronously and return its session_id immediately. Use read_terminal to wait for and consume new output. terminate_terminal is optional because every remaining session is terminated automatically when the turn ends.",
    inputSchema: jsonSchema({
      additionalProperties: false,
      properties: {
        command: {
          description: "Command to run.",
          type: "string",
        },
        cwd: {
          description: "Working directory for the command.",
          type: "string",
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
            interactionMode: "non_interactive",
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

        resetThreadSessionForCommand(session, command, marker, "non_interactive");
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

        return createSuccessResult({
          body: `session_id: ${session.localSessionId}\nstate: running`,
          displayBody: "Terminal command started.",
          semantics: {
            session_id: session.localSessionId,
            state: "running",
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
