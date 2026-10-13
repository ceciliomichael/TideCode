import assert from "node:assert/strict";
import test from "node:test";
import {
  getTerminalTheme,
  isRenderableTerminalDimensions,
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  resolveTerminalSessionWorkspaceRootPath,
} from "../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils";

function withTerminalComputedStyle<T>(callback: () => T): T {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      getComputedStyle: () => ({
        backgroundColor: "rgba(0, 0, 0, 0)",
        color: "",
      }),
    },
  });

  try {
    return callback();
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

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

test("terminal colors follow the TideCode light and dark semantic palettes", () => {
  withTerminalComputedStyle(() => {
    const host = {} as HTMLElement;
    const light = getTerminalTheme(host, "light");
    const dark = getTerminalTheme(host, "dark");

    assert.equal(light.background, "#ffffff");
    assert.equal(light.foreground, "#202221");
    assert.equal(light.red, "#b4232d");
    assert.equal(light.green, "#24783f");
    assert.equal(light.yellow, "#8a5a05");
    assert.equal(light.blue, "#1d5f91");
    assert.notEqual(light.red, light.foreground);
    assert.notEqual(light.green, light.foreground);

    assert.equal(dark.background, "#171718");
    assert.equal(dark.foreground, "#e9e9ea");
    assert.equal(dark.red, "#f48771");
    assert.equal(dark.green, "#8bd6a1");
    assert.equal(dark.yellow, "#e8c56a");
  });
});
