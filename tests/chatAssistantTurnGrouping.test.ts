import assert from "node:assert/strict";
import test from "node:test";
import { groupVisibleTranscriptMessages } from "../src/components/chat/assistantTurnGrouping";
import type { Message } from "../src/types/chat";

function buildMessage(overrides: Partial<Message>): Message {
  return {
    content: "",
    id: overrides.id ?? crypto.randomUUID(),
    role: overrides.role ?? "assistant",
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
  } as Message;
}

test("groupVisibleTranscriptMessages groups contiguous assistant messages into a single turn", () => {
  const grouped = groupVisibleTranscriptMessages([
    buildMessage({ id: "user-1", role: "user", userMessageKind: "human", content: "hello" }),
    buildMessage({ id: "assistant-1", content: "thinking" }),
    buildMessage({ id: "assistant-2", content: "final answer" }),
    buildMessage({ id: "user-2", role: "user", userMessageKind: "human", content: "thanks" }),
  ]);

  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].kind, "user");
  assert.equal(grouped[1].kind, "assistant");
  assert.equal(grouped[2].kind, "user");
  if (grouped[1].kind === "assistant") {
    assert.deepEqual(
      grouped[1].messages.map((message) => message.id),
      ["assistant-1", "assistant-2"],
    );
  }
});
