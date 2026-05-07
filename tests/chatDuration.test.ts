import assert from "node:assert/strict";
import test from "node:test";
import { formatChatDuration } from "../src/components/chatDuration";

test("formatChatDuration formats seconds with no decimals", () => {
  assert.equal(formatChatDuration(8.2), "8s");
});

test("formatChatDuration formats minutes and seconds", () => {
  assert.equal(formatChatDuration(62), "1m 2s");
});

test("formatChatDuration formats hours, minutes, and seconds", () => {
  assert.equal(formatChatDuration(3722), "1h 2m 2s");
});
