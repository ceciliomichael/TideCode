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

function createSnapshot(
  input: { sessionId: number },
  pendingOutputBuffer: string,
  hasExited = false,
) {
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
  getPendingOutput: (writtenCommands: WriteTerminalSessionInput[], callCount: number) => string;
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
      const pending = input.getPendingOutput(input.writeCalls, readCallCount);
      return createSnapshot(sessionInput, pending);
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

test("execute_terminal waits for the marker and returns metadata instead of output", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-summary",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          return "";
        }
        outputDelivered = true;
        const marker = readCompletionMarker(writtenCommands[0]?.data ?? "");
        return `line 1\r\nline 2\r\n${marker}:0\r\n`;
      },
      writeCalls,
    }),
  );

  const executeResult = await getTool(tools, "execute_terminal").execute({
    command: "npm test",
  });

  assert.equal(executeResult.status, "success");
  assert.equal(executeResult.semantics?.state, "completed");
  assert.equal(executeResult.semantics?.line_count, 2);
  assert.match(executeResult.body ?? "", /line_count: 2/u);
  assert.match(executeResult.displayBody ?? "", /Terminal command completed/u);
  assert.doesNotMatch(executeResult.displayBody ?? "", /session_id/u);
  assert.doesNotMatch(executeResult.body ?? "", /exit_code/u);
  assert.ok(!(executeResult.body ?? "").includes("line 1"));
  assert.match(executeResult.body ?? "", /completed/u);

  const readResult = await getTool(tools, "read_terminal").execute({
    limit: 10,
    offset: 1,
    session_id: executeResult.semantics?.session_id as number,
  });
  assert.equal(readResult.status, "success");
  assert.match(readResult.body ?? "", /1: line 1/u);
  assert.match(readResult.body ?? "", /2: line 2/u);
});

test("execute_terminal preserves a completion marker that arrives during output rendering", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const consumedLengths: number[] = [];
  let pendingOutput = "";
  let readCallCount = 0;
  let markerAppended = false;
  let markerLength = 0;

  const tools = createTools(
    "terminal-output-race",
    createMockDependencies({
      consumeSessionOutput: (_owner, input) => {
        if (!markerAppended) {
          const marker = readCompletionMarker(writeCalls[0]?.data ?? "");
          const completionOutput = `${marker}:0\r\n`;
          pendingOutput += completionOutput;
          markerLength = completionOutput.length;
          markerAppended = true;
        }

        const consumedLength = input.pendingOutputLengthToConsume;
        consumedLengths.push(consumedLength ?? -1);
        pendingOutput = consumedLength === undefined
          ? ""
          : pendingOutput.slice(Math.min(consumedLength, pendingOutput.length));
      },
      getPendingOutput: () => "",
      getSessionOutput: async (_owner, sessionInput) => {
        readCallCount += 1;
        if (readCallCount === 1) {
          pendingOutput = "output before completion\r\n";
        }
        return createSnapshot(sessionInput, pendingOutput);
      },
      writeCalls,
    }),
  );

  const result = await getTool(tools, "execute_terminal").execute({
    command: "git commit -m race-test",
    interaction_mode: "non_interactive",
  });

  assert.equal(result.status, "success");
  assert.equal(result.semantics?.state, "completed");
  assert.deepEqual(consumedLengths, ["output before completion\r\n".length, markerLength]);
});

test("execute_terminal reports command failure without returning the numeric exit code", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-failure-summary",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          return "";
        }
        outputDelivered = true;
        return `${readCompletionMarker(writtenCommands[0]?.data ?? "")}:17\n`;
      },
      writeCalls,
    }),
  );

  const result = await getTool(tools, "execute_terminal").execute({ command: "failed-command" });

  assert.equal(result.status, "success");
  assert.match(result.body ?? "", /result: failed/u);
  assert.match(result.displayBody ?? "", /Terminal command failed/u);
  assert.doesNotMatch(result.displayBody ?? "", /session_id/u);
  assert.doesNotMatch(result.body ?? "", /exit_code/u);
  assert.equal(result.semantics?.exit_code, undefined);
});

test("execute_terminal creates a new session instead of treating a stale id as an existing session", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-stale-session-id",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          return "";
        }
        outputDelivered = true;
        return `${readCompletionMarker(writtenCommands[0]?.data ?? "")}:0\n`;
      },
      writeCalls,
    }),
  );

  const result = await getTool(tools, "execute_terminal").execute({
    command: "Write-Output terminal-ok",
    session_id: 0,
    session_key: "stale-test-key",
  });

  assert.equal(result.status, "success");
  assert.equal(typeof result.semantics?.session_id, "number");
  assert.notEqual(result.semantics?.session_id, 0);
  assert.equal(writeCalls.length, 1);
});

test("execute_terminal preserves multiline PowerShell commands and the completion marker", async () => {
  const multilineCommand = [
    "git commit -m \"preserve multiline input\" -m \"First paragraph.",
    "",
    "Validated with tests.\"",
  ].join("\n");
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-multiline",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          return "";
        }
        outputDelivered = true;
        return `${readCompletionMarker(writtenCommands[0]?.data ?? "")}:0\n`;
      },
      writeCalls,
    }),
  );

  await getTool(tools, "execute_terminal").execute({ command: multilineCommand });

  const writtenCommand = writeCalls[0]?.data ?? "";
  assert.equal(writtenCommand.endsWith("\r"), true);
  assert.equal(/[\r\n]/u.test(writtenCommand.slice(0, -1)), false);
  const encodedCommand = writtenCommand.match(/FromBase64String\('([^']+)'\)/u)?.[1];
  assert.ok(encodedCommand);
  assert.equal(Buffer.from(encodedCommand, "base64").toString("utf8"), multilineCommand);
});

test("read_terminal returns normalized 200-character segments and ranges", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const longLine = "x".repeat(450);
  const tools = createTools(
    "terminal-ranges",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          return "";
        }
        outputDelivered = true;
        return `${longLine}\r\n${readCompletionMarker(writtenCommands[0]?.data ?? "")}:0\n`;
      },
      writeCalls,
    }),
  );

  const executeResult = await getTool(tools, "execute_terminal").execute({ command: "echo output" });
  assert.equal(executeResult.semantics?.line_count, 3);

  const readResult = await getTool(tools, "read_terminal").execute({
    limit: 1,
    offset: 2,
    session_id: executeResult.semantics?.session_id as number,
  });
  assert.equal(readResult.semantics?.offset, 2);
  assert.equal(readResult.semantics?.returned_line_count, 1);
  assert.equal((readResult.body ?? "").split("\n")[0]?.startsWith("2: "), true);
  assert.equal((readResult.body ?? "").length <= 210, true);
});

test("carriage-return progress output becomes one readable line", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
  const tools = createTools(
    "terminal-carriage-return",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          return "";
        }
        outputDelivered = true;
        const marker = readCompletionMarker(writtenCommands[0]?.data ?? "");
        return `progress 1\rprogress 2\rprogress 3\r\n${marker}:0\n`;
      },
      writeCalls,
    }),
  );

  const executeResult = await getTool(tools, "execute_terminal").execute({ command: "progress" });
  const readResult = await getTool(tools, "read_terminal").execute({
    limit: 10,
    offset: 1,
    session_id: executeResult.semantics?.session_id as number,
  });

  assert.equal(readResult.semantics?.line_count, 1);
  assert.match(readResult.body ?? "", /progress 3/u);
  assert.doesNotMatch(readResult.body ?? "", /progress 1/u);
});

test("execute_terminal stops at a confirmation prompt and interact_terminal resumes it", async () => {
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
        const marker = readCompletionMarker(writtenCommands[0]?.data ?? "");
        return `accepted\r\n${marker}:0\r\n`;
      },
      writeCalls,
    }),
  );

  const executeResult = await getTool(tools, "execute_terminal").execute({ command: "interactive-command" });
  const sessionId = executeResult.semantics?.session_id as number;
  assert.equal(executeResult.semantics?.state, "needs_interaction");
  assert.equal(executeResult.semantics?.interaction_required, true);
  assert.match(executeResult.body ?? "", /Continue\?/u);

  const interactionResult = await getTool(tools, "interact_terminal").execute({
    keys: ["y", "ENTER"],
    session_id: sessionId,
  });
  assert.equal(interactionResult.semantics?.state, "completed");
  assert.doesNotMatch(interactionResult.body ?? "", /exit_code/u);
  assert.equal(writeCalls[1]?.data, "y\r");
});

test("read_terminal returns the visible screen for an alternate-screen interaction", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputCallCount = 0;
  const tools = createTools(
    "terminal-screen-read",
    createMockDependencies({
      getPendingOutput: () => {
        outputCallCount += 1;
        if (outputCallCount === 1) {
          return "\u001B[?1049h\u001B[2J\u001B[HChoose\r\n> Install";
        }
        return "";
      },
      writeCalls,
    }),
  );

  const executeResult = await getTool(tools, "execute_terminal").execute({ command: "interactive-screen" });
  assert.equal(executeResult.semantics?.state, "needs_interaction");
  assert.equal(executeResult.semantics?.interaction_kind, "screen");
  assert.doesNotMatch(executeResult.body ?? "", /Choose/u);
  assert.match(executeResult.displayBody ?? "", /Interactive terminal screen/u);
  assert.doesNotMatch(executeResult.displayBody ?? "", /session_id/u);

  const readResult = await getTool(tools, "read_terminal").execute({
    session_id: executeResult.semantics?.session_id as number,
  });
  assert.equal(readResult.semantics?.view, "screen");
  assert.match(readResult.body ?? "", /screen: alternate/u);
  assert.match(readResult.body ?? "", /1: Choose/u);
  assert.match(readResult.body ?? "", /2: > Install/u);

  const interactionResult = await getTool(tools, "interact_terminal").execute({
    keys: ["ENTER"],
    session_id: executeResult.semantics?.session_id as number,
  });
  assert.equal(interactionResult.semantics?.state, "needs_interaction");
  assert.match(interactionResult.body ?? "", /screen: alternate/u);
  assert.match(interactionResult.displayBody ?? "", /Interactive terminal screen/u);
  assert.doesNotMatch(interactionResult.displayBody ?? "", /session_id/u);
});

test("interact_terminal can send Ctrl-C and terminate a session", async () => {
  const writeCalls: WriteTerminalSessionInput[] = [];
  const terminatedSessionIds: number[] = [];
  let outputCallCount = 0;
  const tools = createTools(
    "terminal-control",
    createMockDependencies({
      getPendingOutput: (writtenCommands) => {
        outputCallCount += 1;
        if (outputCallCount === 1) {
          return "Press Enter to continue\n";
        }
        return `${readCompletionMarker(writtenCommands[0]?.data ?? "")}:0\n`;
      },
      terminateSession: (_owner, sessionId) => {
        terminatedSessionIds.push(sessionId);
      },
      writeCalls,
    }),
  );

  const executeResult = await getTool(tools, "execute_terminal").execute({ command: "long-running-command" });
  const sessionId = executeResult.semantics?.session_id as number;
  assert.equal(executeResult.semantics?.state, "needs_interaction");

  const interactResult = await getTool(tools, "interact_terminal").execute({
    keys: ["CTRL_C"],
    session_id: sessionId,
  });
  assert.equal(interactResult.status, "success");
  assert.equal(writeCalls[1]?.data, "\u0003");

  let terminateSessionId = 0;
  const terminateTools = createTools(
    "terminal-control-terminate",
    createMockDependencies({
      getPendingOutput: () => "Continue? [y/N]\n",
      terminateSession: (_owner, sessionId) => {
        terminateSessionId = sessionId;
      },
      writeCalls: [],
    }),
  );
  const terminateExecuteResult = await getTool(terminateTools, "execute_terminal").execute({
    command: "waiting-command",
  });
  const terminateResult = await getTool(terminateTools, "interact_terminal").execute({
    session_id: terminateExecuteResult.semantics?.session_id as number,
    terminate: true,
  });
  assert.equal(terminateResult.status, "success");
  assert.deepEqual(terminatedSessionIds, []);
  assert.equal(terminateSessionId, 7);
});

test("execute_terminal preserves sandbox validation", async () => {
  let createSessionCalled = false;
  const tools = createTools(
    "terminal-sandbox",
    createMockDependencies({
      getPendingOutput: () => "",
      createSession: async () => {
        createSessionCalled = true;
        return {
          cwd: "/workspace",
          isReused: false,
          sessionId: 8,
          shell: "pwsh",
        };
      },
      writeCalls: [],
    }),
  );

  const result = await getTool(tools, "execute_terminal").execute({ command: "cd ../outside" });
  assert.equal(result.status, "error");
  assert.equal(createSessionCalled, false);
  assert.match(result.summary ?? "", /outside the sandbox roots/u);
});

test("turn cleanup still terminates every AI terminal session", async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), "tidecode-terminal-turn-cleanup-"));
  const terminatedSessionIds: number[] = [];
  let nextSessionId = 70;
  const writeCalls: WriteTerminalSessionInput[] = [];
  let outputDelivered = false;
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
      getPendingOutput: (writtenCommands) => {
        if (outputDelivered) {
          outputDelivered = false;
          return "";
        }
        outputDelivered = true;
        return `${readCompletionMarker(writtenCommands[writtenCommands.length - 1]?.data ?? "")}:0\n`;
      },
      terminateSession: (_owner, sessionId) => {
        terminatedSessionIds.push(sessionId);
      },
      writeCalls,
    }),
  );

  try {
    await getTool(tools, "execute_terminal").execute({ command: "first" });
    await getTool(tools, "execute_terminal").execute({ command: "second" });
    await terminateAllBackgroundSessionsForTurn(
      webContentsStub,
      workspaceRootPath,
      "turn-cleanup",
      (_owner, sessionId) => {
        terminatedSessionIds.push(sessionId);
      },
    );
    assert.deepEqual(terminatedSessionIds, [70, 71]);
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true });
  }
});

test("agent mode exposes the three terminal tools and plan mode exposes none", async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), "tidecode-terminal-tool-exposure-"));
  try {
    const agentTools = await createNativeAgentTools(
      {
        webContents: webContentsStub,
        workspaceRootPath,
      },
      { chatMode: "agent" },
    );
    const planTools = await createNativeAgentTools(
      {
        webContents: webContentsStub,
        workspaceRootPath,
      },
      { chatMode: "plan" },
    );

    assert.ok("execute_terminal" in agentTools);
    assert.ok("interact_terminal" in agentTools);
    assert.ok("read_terminal" in agentTools);
    assert.ok(!("execute_terminal" in planTools));
    assert.ok(!("interact_terminal" in planTools));
    assert.ok(!("read_terminal" in planTools));
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true });
  }
});
