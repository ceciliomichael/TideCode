import assert from "node:assert/strict";
import test from "node:test";
import { getTerminalWorkspaceKey } from "../../src/pages/chatInterface/chatWorkspaceUiState.utils";

test("filed project threads share the same terminal workspace key", () => {
  const firstKey = getTerminalWorkspaceKey({
    activeConversationId: "conversation-a",
    activeWorkspacePath: "/projects/atlas",
    selectedFolderId: "folder-1",
  });
  const secondKey = getTerminalWorkspaceKey({
    activeConversationId: "conversation-b",
    activeWorkspacePath: "/projects/atlas",
    selectedFolderId: "folder-2",
  });

  assert.equal(firstKey, "/projects/atlas");
  assert.equal(secondKey, "/projects/atlas");
});

test("unfiled threads keep separate terminal workspace keys when no project path is available", () => {
  const firstKey = getTerminalWorkspaceKey({
    activeConversationId: "conversation-a",
    activeWorkspacePath: null,
    selectedFolderId: null,
  });
  const secondKey = getTerminalWorkspaceKey({
    activeConversationId: "conversation-b",
    activeWorkspacePath: null,
    selectedFolderId: null,
  });

  assert.equal(firstKey, "unfiled:conversation-a");
  assert.equal(secondKey, "unfiled:conversation-b");
});

test("terminal workspace key falls back to the global key when no workspace is available", () => {
  assert.equal(
    getTerminalWorkspaceKey({
      activeConversationId: null,
      activeWorkspacePath: "   ",
      selectedFolderId: null,
    }),
    "__global__",
  );
});
