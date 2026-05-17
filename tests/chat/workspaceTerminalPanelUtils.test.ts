import assert from "node:assert/strict";
import test from "node:test";
import {
  isRenderableTerminalDimensions,
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  resolveTerminalSessionWorkspaceRootPath,
} from "../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils";

test("terminal viewport must reach the minimum dimensions before rendering buffered output", () => {
  assert.equal(
    isRenderableTerminalDimensions({
      cols: MIN_TERMINAL_COLS,
      rows: MIN_TERMINAL_ROWS,
    }),
    true,
  );

  assert.equal(
    isRenderableTerminalDimensions({
      cols: MIN_TERMINAL_COLS - 1,
      rows: MIN_TERMINAL_ROWS,
    }),
    false,
  );

  assert.equal(
    isRenderableTerminalDimensions({
      cols: MIN_TERMINAL_COLS,
      rows: MIN_TERMINAL_ROWS - 1,
    }),
    false,
  );
});

test("terminal session workspace roots preserve the original workspace path when available", () => {
  assert.equal(resolveTerminalSessionWorkspaceRootPath("  C:\\repo  "), "C:\\repo");
  assert.equal(resolveTerminalSessionWorkspaceRootPath(""), null);
  assert.equal(resolveTerminalSessionWorkspaceRootPath(null), null);
});
