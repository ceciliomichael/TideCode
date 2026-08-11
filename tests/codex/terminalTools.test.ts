import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { WebContents } from "electron";
import type { CreateTerminalSessionInput, WriteTerminalSessionInput } from "../../src/types/chat";
import { createNativeAgentTools } from "../../electron/chat/shared/tools";
import {
  createTerminalToolSet,
  terminateAllBackgroundSessionsForTurn,
  type TerminalToolDependencies,
} from "../../electron/chat/shared/tools/terminalTools";

const webContentsStub = {
  id: 42,
  isDestroyed: () => false,
  once: () => undefined,
} as unknown as WebContents;

type ToolResult = {
  body?: string;
  displayBody?: string;
  semantics?: Record<string, unknown>;
  status?: string;
  summary?: string;
  truncated?: boolean;
};

type Tool = {
  execute: (
    input: Record<string, unknown>,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<ToolResult>;
};

function getTool(tools: ReturnType<typeof createTerminalToolSet>, name: string) {
  return tools[name as keyof typeof tools] as unknown as Tool;
}

function readCompletionMarker(writtenCommand: string) {
  const markerMatch = writtenCommand.match(/__EDONE_[A-Za-z0-9_]+__/u);
  assert.ok(markerMatch, "expected a completion marker");
  return markerMatch[0];
}

function createSnapshot(input: { sessionId: number }, pendingOutputBuffer: string, hasExited = false) {
  return {
    cwd: "/workspace",
    exitCode: null,
    hasExited,
    label: null,
    outputBuffer: pendingOutputBuffer,
    pendingOutputBuffer,
    shellLabel: "pwsh",
    signal: null,
    sessionId: input.sessionId,
  };
}

function createMockDependencies(input: {
  createSession?: (sessionInput: CreateTerminalSessionInput) => Promise<{
    cwd: string;
    isReused: boolean;
    sessionId: number;
    shell: string;
  }>;
  consumeSessionOutput?: TerminalToolDependencies["consumeSessionOutput"];
  getSessionOutput?: TerminalToolDependencies["getSessionOutput"];
  getPendingOutput?: (writtenCommands: WriteTerminalSessionInput[], callCount: number) => string;
  resizeSession?: TerminalToolDependencies["resizeSession"];
  terminateSession?: TerminalToolDependencies["terminateSession"];
  writeCalls: WriteTerminalSessionInput[];
}) {
  let readCallCount = 0;
  const dependencies: Partial<TerminalToolDependencies> = {
    createSession: async (_owner, sessionInput) => {
      const created = input.createSession
        ? await input.createSession(sessionInput)
        : {
            cwd: sessionInput.cwd ?? "/workspace",
            isReused: false,
            sessionId: 7,
            shell: "pwsh",
          };
      return {
        bufferedOutput: "",
        cwd: created.cwd,
        isReused: created.isReused,
        sessionId: created.sessionId,
        shell: created.shell,
        workspaceRootPath: sessionInput.workspaceRootPath ?? "/workspace",
      };
    },
    consumeSessionOutput: input.consumeSessionOutput ?? (() => undefined),
    getSessionOutput: input.getSessionOutput ?? (async (_owner, sessionInput) => {
      readCallCount += 1;
      return createSnapshot(
        sessionInput,
        input.getPendingOutput?.(input.writeCalls, readCallCount) ?? "",
      );
    }),
    resizeSession: input.resizeSession ?? (async () => undefined),
    terminateSession: input.terminateSession ?? (() => undefined),
    writeToSession: async (_owner, writeInput) => {
      input.writeCalls.push(writeInput);
    },
  };
  return dependencies;
}

function createTools(
  conversationId: string,
  dependencies: Partial<TerminalToolDependencies>,
  extraContext: Record<string, unknown> = {},
) {
  return createTerminalToolSet(
    {
      conversationId,
      webContents: webContentsStub,
      workspaceRootPath: "/workspace",
      ...extraContext,
    },
    dependencies,
  );
}

test("execute_terminal starts asynchronously and returns a session id without polling", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let readCallCount = 0;
  const tools = createTools(
    "terminal-async-start",
    createMockDependencies({
      getSessionOutput: async (_owner, input) => {
        readCallCount += 1;
        return createSnapshot(input, "unexpected");
      },
      writeCalls,
    }),
  );

  const result = await getTool(tools, "execute_terminal").execute({ command: "npm test" });

  assert.equal(result.status, "success");
  assert.equal(result.semantics?.state, "running");
  assert.equal(typeof result.semantics?.session_id, "number");
  assert.match(result.body ?? "", /state: running/u);
  assert.equal(readCallCount, 0);
  assert.equal(writeCalls.length, 1);
});

test("read_terminal waits for completion and returns only unread output", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-consuming-read",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) return "";
        outputDelivered = true;
        const marker = readCompletionMarker(writtenCommands[0]?.data ?? "");
        return `line 1\r\nline 2\r\n${marker}:0\r\n`;
      },
      writeCalls,
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "npm test" });
  const sessionId = started.semantics?.session_id as number;
  const firstRead = await getTool(tools, "read_terminal").execute({
    session_id: sessionId,
    wait_seconds: 15,
  });
  assert.equal(firstRead.semantics?.state, "completed");
  assert.match(firstRead.body ?? "", /1: line 1/u);
  assert.match(firstRead.body ?? "", /2: line 2/u);

  const secondRead = await getTool(tools, "read_terminal").execute({
    session_id: sessionId,
    wait_seconds: 0,
  });
  assert.equal(secondRead.semantics?.state, "completed");
  assert.match(secondRead.body ?? "", /No new terminal output/u);
  assert.doesNotMatch(secondRead.body ?? "", /line 1|line 2/u);
});

test("read_terminal never waits again after a session has completed", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const observedPollingValues: number[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-completed-read",
    createMockDependencies({
      getSessionOutput: async (_owner, input) => {
        observedPollingValues.push(input.pollingMs ?? -1);
        if (outputDelivered) return createSnapshot(input, "");
        outputDelivered = true;
        return createSnapshot(input, `${readCompletionMarker(writeCalls[0]?.data ?? "")}:0\n`);
      },
      writeCalls,
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "quick command" });
  const sessionId = started.semantics?.session_id as number;
  await getTool(tools, "read_terminal").execute({ session_id: sessionId, wait_seconds: 15 });
  await getTool(tools, "read_terminal").execute({ session_id: sessionId, wait_seconds: 15 });

  assert.equal(observedPollingValues.length, 2);
  assert.equal(observedPollingValues[1], 0);
});

test("repeated read_terminal calls continue from the previous collection window", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const tools = createTools(
    "terminal-incremental-read",
    createMockDependencies({
      getPendingOutput: (writtenCommands, callCount) => {
        if (callCount === 1) return "first window\n";
        if (callCount === 2) {
          return `second window\n${readCompletionMarker(writtenCommands[0]?.data ?? "")}:0\n`;
        }
        return "";
      },
      writeCalls,
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "long command" });
  const sessionId = started.semantics?.session_id as number;
  const firstRead = await getTool(tools, "read_terminal").execute({ session_id: sessionId, wait_seconds: 0 });
  assert.equal(firstRead.semantics?.state, "running");
  assert.match(firstRead.body ?? "", /first window/u);

  const secondRead = await getTool(tools, "read_terminal").execute({ session_id: sessionId, wait_seconds: 0 });
  assert.equal(secondRead.semantics?.state, "completed");
  assert.match(secondRead.body ?? "", /second window/u);
  assert.doesNotMatch(secondRead.body ?? "", /first window/u);
});

test("read_terminal bounds the requested wait to fifteen seconds", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const observedPollingValues: number[] = [];
  const tools = createTools(
    "terminal-wait-bound",
    createMockDependencies({
      getSessionOutput: async (_owner, input) => {
        observedPollingValues.push(input.pollingMs ?? -1);
        const marker = readCompletionMarker(writeCalls[0]?.data ?? "");
        return createSnapshot(input, `${marker}:0\n`);
      },
      writeCalls,
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "bounded wait" });
  await getTool(tools, "read_terminal").execute({
    session_id: started.semantics?.session_id,
    wait_seconds: 999,
  });

  assert.equal(observedPollingValues.length, 1);
  assert.ok(observedPollingValues[0] >= 0);
  assert.ok(observedPollingValues[0] <= 15_000);
});

test("read_terminal reports command failure without exposing the numeric exit code", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const tools = createTools(
    "terminal-failure",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => `${readCompletionMarker(writtenCommands[0]?.data ?? "")}:17\n`,
      writeCalls,
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "failed-command" });
  const result = await getTool(tools, "read_terminal").execute({
    session_id: started.semantics?.session_id,
    wait_seconds: 0,
  });

  assert.equal(result.semantics?.state, "completed");
  assert.match(result.body ?? "", /result: failed/u);
  assert.doesNotMatch(result.body ?? "", /17|exit_code/u);
});

test("read_terminal detects a prompt and interact_terminal sends text plus Enter", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputCallCount = 0;
  const tools = createTools(
    "terminal-interaction",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        outputCallCount += 1;
        if (outputCallCount === 1) {
          return "Continue? [y/N]\r\n";
        }
        return `${readCompletionMarker(writtenCommands[0]?.data ?? "")}:0\r\n`;
      },
      writeCalls,
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "interactive-command" });
  const sessionId = started.semantics?.session_id as number;
  const promptResult = await getTool(tools, "read_terminal").execute({
    session_id: sessionId,
    wait_seconds: 0,
  });

  assert.equal(promptResult.semantics?.state, "needs_interaction");
  assert.equal(promptResult.semantics?.interaction_kind, "confirmation");
  assert.equal(promptResult.semantics?.interaction_required, true);
  assert.equal(promptResult.semantics?.next_action, undefined);
  assert.match(promptResult.body ?? "", /Continue\?/u);

  const interactionResult = await getTool(tools, "interact_terminal").execute({
    keys: ["ENTER"],
    session_id: sessionId,
    text: "yes",
  });

  assert.equal(interactionResult.status, "success");
  assert.equal(interactionResult.semantics?.state, "completed");
  assert.equal(interactionResult.semantics?.interaction_applied, true);
  assert.equal(interactionResult.semantics?.input_sent, true);
  assert.equal(interactionResult.semantics?.next_action, undefined);
  assert.match(interactionResult.body ?? "", /interaction_applied: true/u);
  assert.match(interactionResult.displayBody ?? "", /Terminal input sent/u);
  assert.equal(writeCalls[1]?.data, "yes\r");
});

test("interact_terminal acknowledges input while the command is still running", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const tools = createTools(
    "terminal-interaction-running",
    createMockDependencies({ writeCalls }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "long-running-command" });
  const result = await getTool(tools, "interact_terminal").execute({
    keys: ["ENTER"],
    session_id: started.semantics?.session_id,
    text: "y",
  });

  assert.equal(result.status, "success");
  assert.equal(result.semantics?.state, "running");
  assert.equal(result.semantics?.interaction_applied, true);
  assert.equal(result.semantics?.input_sent, true);
  assert.equal(result.semantics?.next_action, undefined);
  assert.doesNotMatch(result.body ?? "", /next_action/u);
  assert.equal(result.displayBody, "Terminal input sent. Read terminal for updates.");
  assert.equal(writeCalls[1]?.data, "y\r");
});

test("execute_terminal preserves multiline PowerShell commands and the completion marker", async () => {
  const multilineCommand = [
    "git commit -m \"preserve multiline input\" -m \"First paragraph.",
    "",
    "Validated with tests.\"",
  ].join("\n");
  const writeCalls: WriteTerminalSessionInput[] = [];
  const tools = createTools(
    "terminal-multiline",
    createMockDependencies({ writeCalls }),
  );

  await getTool(tools, "execute_terminal").execute({ command: multilineCommand });

  const writtenCommand = writeCalls[0]?.data ?? "";
  assert.equal(writtenCommand.endsWith("\r"), true);
  assert.equal(/[\r\n]/u.test(writtenCommand.slice(0, -1)), false);
  const encodedCommand = writtenCommand.match(/FromBase64String\('([^']+)'\)/u)?.[1];
  assert.ok(encodedCommand);
  assert.equal(Buffer.from(encodedCommand, "base64").toString("utf8"), multilineCommand);
});

test("terminate_terminal is optional and stops a selected session early", async () => {
  const terminatedSessionIds: number[] = [];
  const tools = createTools(
    "terminal-explicit-termination",
    createMockDependencies({
      terminateSession: (_owner, sessionId) => terminatedSessionIds.push(sessionId),
      writeCalls: [],
    }),
  );

  const started = await getTool(tools, "execute_terminal").execute({ command: "long-running" });
  const result = await getTool(tools, "terminate_terminal").execute({
    session_id: started.semantics?.session_id,
  });
  assert.equal(result.status, "success");
  assert.equal(result.semantics?.state, "terminated");
  assert.deepEqual(terminatedSessionIds, [7]);

  const missing = await getTool(tools, "read_terminal").execute({
    session_id: started.semantics?.session_id,
    wait_seconds: 0,
  });
  assert.equal(missing.status, "error");
});

test("execute_terminal preserves sandbox validation", async () => {
  let createSessionCalled = false;
  const tools = createTools(
    "terminal-sandbox",
    createMockDependencies({
      createSession: async () => {
        createSessionCalled = true;
        return { cwd: "/workspace", isReused: false, sessionId: 8, shell: "pwsh" };
      },
      writeCalls: [],
    }),
  );

  const result = await getTool(tools, "execute_terminal").execute({ command: "cd ../outside" });
  assert.equal(result.status, "error");
  assert.equal(createSessionCalled, false);
  assert.match(result.summary ?? "", /outside the sandbox roots/u);
});

test("turn cleanup terminates every session even when terminate_terminal is unused", async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), "tidecode-terminal-turn-cleanup-"));
  const terminatedSessionIds: number[] = [];
  let nextSessionId = 70;
  const tools = createTerminalToolSet(
    {
      conversationId: "terminal-turn-cleanup",
      terminalExecutionMode: "sandbox",
      turnId: "turn-cleanup",
      webContents: webContentsStub,
      workspaceRootPath,
    },
    createMockDependencies({
      createSession: async () => ({
        cwd: workspaceRootPath,
        isReused: false,
        sessionId: nextSessionId++,
        shell: "pwsh",
      }),
      terminateSession: (_owner, sessionId) => terminatedSessionIds.push(sessionId),
      writeCalls: [],
    }),
  );

  try {
    await getTool(tools, "execute_terminal").execute({ command: "first" });
    await getTool(tools, "execute_terminal").execute({ command: "second" });
    await terminateAllBackgroundSessionsForTurn(
      webContentsStub,
      workspaceRootPath,
      "turn-cleanup",
      (_owner, sessionId) => terminatedSessionIds.push(sessionId),
    );
    assert.deepEqual(terminatedSessionIds, [70, 71]);
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true });
  }
});

test("agent mode exposes asynchronous terminal tools and plan mode exposes none", async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), "tidecode-terminal-tool-exposure-"));
  try {
    const agentTools = await createNativeAgentTools(
      { webContents: webContentsStub, workspaceRootPath },
      { chatMode: "agent" },
    );
    const planTools = await createNativeAgentTools(
      { webContents: webContentsStub, workspaceRootPath },
      { chatMode: "plan" },
    );

    assert.ok("execute_terminal" in agentTools);
    assert.ok("interact_terminal" in agentTools);
    assert.ok("read_terminal" in agentTools);
    assert.ok("terminate_terminal" in agentTools);
    assert.ok(!("execute_terminal" in planTools));
    assert.ok(!("interact_terminal" in planTools));
    assert.ok(!("read_terminal" in planTools));
    assert.ok(!("terminate_terminal" in planTools));
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true });
  }
});
