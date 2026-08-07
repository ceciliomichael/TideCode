import { jsonSchema, tool } from "ai";
import type { AgentToolExecutionResult } from "../toolTypes";
import {
  allocateVisibleSessionId,
  assertSandboxCommand,
  assertTerminalOwner,
  buildMarkedCommand,
  buildTerminalCommandSummary,
  clampInteger,
  createCompletionMarker,
  createTerminalCommandResult,
  createTerminalErrorResult,
  createThreadAiSession,
  getOrCreateThreadStore,
  normalizeCommand,
  prepareTerminalCommand,
  raceWithAbort,
  removeThreadSession,
  resetThreadSessionForCommand,
  resolveTerminalWorkspaceCwd,
  type TerminalToolRuntime,
  waitForTerminalCommand,
  throwIfAborted,
} from "./terminalToolShared";

interface ExecuteTerminalInput {
  command?: string;
  cwd?: string;
  cols?: number;
  interaction_mode?: "auto" | "interactive" | "non_interactive";
  label?: string;
  rows?: number;
}

function getInteractionMode(value: ExecuteTerminalInput["interaction_mode"]) {
  return value === "interactive" || value === "non_interactive" ? value : "auto";
}

export function createExecuteTerminalTool(runtime: TerminalToolRuntime) {
  return tool({
    description:
      "Start a new terminal command and wait until it completes or needs interactive input. This tool creates and returns the session_id; do not provide one. Returns terminal metadata; use read_terminal for output and interact_terminal for input.",
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
        cols: {
          maximum: 400,
          minimum: 20,
          type: "number",
        },
        interaction_mode: {
          description: "Whether to automatically detect interactive prompts.",
          enum: ["auto", "interactive", "non_interactive"],
          type: "string",
        },
        label: {
          description: "Human-readable session label.",
          type: "string",
        },
        rows: {
          maximum: 200,
          minimum: 6,
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

        const cols = clampInteger(input.cols, 20, 400, 220);
        const rows = clampInteger(input.rows, 6, 200, 50);
        const interactionMode = getInteractionMode(input.interaction_mode);
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
              label: input.label?.trim() || null,
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
            interactionMode,
            label: input.label?.trim() || null,
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

        resetThreadSessionForCommand(session, command, marker, interactionMode);
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

        await waitForTerminalCommand(runtime, session, dependencies, abortSignal);
        const summary = buildTerminalCommandSummary(session);
        return createTerminalCommandResult(session, summary);
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
            // The turn cleanup will make a second best-effort termination attempt.
          }
        }

        if (abortSignal?.aborted) {
          throw error;
        }
        return createTerminalErrorResult(
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Terminal command failed.",
        );
      }
    },
  });
}
