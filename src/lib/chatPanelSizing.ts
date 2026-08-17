/**
 * The composer is centered with a 1rem inset on each side of the chat panel.
 * Keep its input surface at the width used by the full runtime-control row so
 * the attachment, mode, model, reasoning, context, and send controls do not
 * get compressed into a second row when the editor is open.
 */
export const CHAT_INPUT_SURFACE_MIN_WIDTH = 480;
export const CHAT_COMPOSER_SIDE_INSET = 16;
export const MIN_CHAT_PANEL_WIDTH =
  CHAT_INPUT_SURFACE_MIN_WIDTH + CHAT_COMPOSER_SIDE_INSET * 2;

export const MIN_CHAT_PANEL_VIEWPORT_RATIO = 0.2;
export const MAX_CHAT_PANEL_VIEWPORT_RATIO = 0.35;

export interface ChatPanelBounds {
  maxWidth: number;
  minWidth: number;
}

function normalizeViewportWidth(viewportWidth: number) {
  return Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : 0;
}

export function getChatPanelBounds(viewportWidth: number): ChatPanelBounds {
  const normalizedViewportWidth = normalizeViewportWidth(viewportWidth);
  const minWidth = Math.max(
    MIN_CHAT_PANEL_WIDTH,
    Math.round(normalizedViewportWidth * MIN_CHAT_PANEL_VIEWPORT_RATIO),
  );
  const maxWidth = Math.max(
    minWidth,
    Math.round(normalizedViewportWidth * MAX_CHAT_PANEL_VIEWPORT_RATIO),
  );

  return { maxWidth, minWidth };
}

export function clampChatPanelWidth(width: number, viewportWidth: number) {
  const { maxWidth, minWidth } = getChatPanelBounds(viewportWidth);
  const normalizedWidth = Number.isFinite(width) ? Math.round(width) : minWidth;

  return Math.min(maxWidth, Math.max(minWidth, normalizedWidth));
}
