import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_COMPOSER_SIDE_INSET,
  CHAT_INPUT_SURFACE_MIN_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  clampChatPanelWidth,
  getChatPanelBounds,
} from "../src/lib/chatPanelSizing";

test("chat panel minimum includes the composer side insets", () => {
  assert.equal(
    MIN_CHAT_PANEL_WIDTH,
    CHAT_INPUT_SURFACE_MIN_WIDTH + CHAT_COMPOSER_SIDE_INSET * 2,
  );
});

test("chat panel keeps enough width for the composer on narrower desktop windows", () => {
  const bounds = getChatPanelBounds(1280);

  assert.equal(bounds.minWidth, MIN_CHAT_PANEL_WIDTH);
  assert.equal(bounds.maxWidth, MIN_CHAT_PANEL_WIDTH);
});

test("chat panel retains the resizable viewport cap once it exceeds the composer minimum", () => {
  const bounds = getChatPanelBounds(1920);

  assert.equal(bounds.minWidth, MIN_CHAT_PANEL_WIDTH);
  assert.equal(bounds.maxWidth, 672);
});

test("chat panel width is clamped to the composer-safe bounds", () => {
  assert.equal(clampChatPanelWidth(320, 1280), MIN_CHAT_PANEL_WIDTH);
  assert.equal(clampChatPanelWidth(700, 1280), MIN_CHAT_PANEL_WIDTH);
  assert.equal(clampChatPanelWidth(320, 1920), MIN_CHAT_PANEL_WIDTH);
  assert.equal(clampChatPanelWidth(900, 1920), 672);
});
