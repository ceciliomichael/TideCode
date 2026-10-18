import assert from "node:assert/strict";
import test from "node:test";
import {
  createTerminalTabKey,
  getWorkspaceKeyFromTerminalTabKey,
  isCurrentTerminalTabGeneration,
  nextTerminalTabGeneration,
} from "../../src/components/chat/workspaceTerminalPanel/workspaceTerminalPanelUtils";

test("stale terminal creation and restart responses are rejected by generation", () => {
  const generations = new Map<string, number>();
  const tab = createTerminalTabKey("project A", 1);
  const first = nextTerminalTabGeneration(generations, tab);
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, first), true);

  const restarted = nextTerminalTabGeneration(generations, tab);
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, first), false);
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, restarted), true);

  nextTerminalTabGeneration(generations, tab); // Closing the tab invalidates pending work.
  assert.equal(isCurrentTerminalTabGeneration(generations, tab, restarted), false);
});

test("terminal generations are independent across tabs and workspace keys are decoded", () => {
  const generations = new Map<string, number>();
  const firstTab = createTerminalTabKey("C:\\repo A", 1);
  const secondTab = createTerminalTabKey("C:\\repo B", 1);
  const firstGeneration = nextTerminalTabGeneration(generations, firstTab);
  nextTerminalTabGeneration(generations, secondTab);
  nextTerminalTabGeneration(generations, secondTab);

  assert.equal(isCurrentTerminalTabGeneration(generations, firstTab, firstGeneration), true);
  assert.equal(getWorkspaceKeyFromTerminalTabKey(firstTab), "C:\\repo A");
  assert.equal(getWorkspaceKeyFromTerminalTabKey(secondTab), "C:\\repo B");
});
