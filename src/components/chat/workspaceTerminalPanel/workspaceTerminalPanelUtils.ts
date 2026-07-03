import type { ITerminalOptions, Terminal } from "@xterm/xterm";
import type { ResolvedTheme } from "../../../lib/theme";
import { MIN_TERMINAL_PANEL_HEIGHT } from "../../../lib/terminalPanelSizing";

export const MIN_TERMINAL_COLS = 20;
export const MIN_TERMINAL_ROWS = 6;
const TERMINAL_TAB_KEY_SEPARATOR = "::terminal-tab-";

type TerminalTheme = NonNullable<ITerminalOptions["theme"]>;

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export function clampPanelHeight(nextHeight: number, maxHeightLimit: number) {
  const safeMaxHeight = Math.max(MIN_TERMINAL_PANEL_HEIGHT, maxHeightLimit);
  return Math.max(MIN_TERMINAL_PANEL_HEIGHT, Math.min(nextHeight, safeMaxHeight));
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Failed to process terminal action.";
}

export function getSessionDimensions(terminal: Terminal) {
  return {
    cols: Math.max(MIN_TERMINAL_COLS, terminal.cols || 80),
    rows: Math.max(MIN_TERMINAL_ROWS, terminal.rows || 24),
  };
}

export function isRenderableTerminalDimensions(
  dimensions: TerminalDimensions | null | undefined,
): dimensions is TerminalDimensions {
  return Boolean(
    dimensions &&
      dimensions.cols >= MIN_TERMINAL_COLS &&
      dimensions.rows >= MIN_TERMINAL_ROWS,
  );
}

export function getNativeSelectionTextWithinHost(hostElement: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return "";
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) {
    return "";
  }

  const isAnchorInsideHost = hostElement.contains(anchorNode);
  const isFocusInsideHost = hostElement.contains(focusNode);
  if (!isAnchorInsideHost && !isFocusInsideHost) {
    return "";
  }

  return selection.toString();
}

export function clearSelectionWithinHost(hostElement: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) {
    return;
  }

  const isAnchorInsideHost = hostElement.contains(anchorNode);
  const isFocusInsideHost = hostElement.contains(focusNode);
  if (!isAnchorInsideHost && !isFocusInsideHost) {
    return;
  }

  selection.removeAllRanges();
}

export async function copyTerminalSelectionToClipboard({
  hostElement,
  terminal,
}: {
  hostElement: HTMLElement;
  terminal: Terminal;
}) {
  const selectionText = terminal.getSelection() || getNativeSelectionTextWithinHost(hostElement);
  if (!selectionText) {
    return false;
  }

  await navigator.clipboard.writeText(selectionText);
  return true;
}

export function getTerminalTheme(
  hostElement: HTMLElement,
  resolvedTheme: ResolvedTheme,
): TerminalTheme {
  const hostStyles = window.getComputedStyle(hostElement);
  const foreground = hostStyles.color;
  const background = hostStyles.backgroundColor;
  const lightModeTextColor = "#101011";
  const selectionBackground = "rgba(96, 98, 102, 0.22)";
  const selectionInactiveBackground = selectionBackground;

  if (resolvedTheme === "dark") {
    return {
      background,
      foreground,
      cursor: foreground,
      selectionBackground,
      selectionInactiveBackground,
      black: "#1f1f21",
      red: "#f48771",
      green: "#9ad792",
      yellow: "#f5d76e",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#d9d9da",
      brightBlack: "#7d7d83",
      brightRed: "#ffb3a7",
      brightGreen: "#b8e8ae",
      brightYellow: "#f8e194",
      brightBlue: "#a6bcff",
      brightMagenta: "#d8c1ff",
      brightCyan: "#9be6ff",
      brightWhite: "#ffffff",
    };
  }

  return {
    background,
    foreground: lightModeTextColor,
    cursor: lightModeTextColor,
    selectionBackground,
    selectionInactiveBackground,
    black: lightModeTextColor,
    red: lightModeTextColor,
    green: lightModeTextColor,
    yellow: lightModeTextColor,
    blue: lightModeTextColor,
    magenta: lightModeTextColor,
    cyan: lightModeTextColor,
    white: lightModeTextColor,
    brightBlack: lightModeTextColor,
    brightRed: lightModeTextColor,
    brightGreen: lightModeTextColor,
    brightYellow: lightModeTextColor,
    brightBlue: lightModeTextColor,
    brightMagenta: lightModeTextColor,
    brightCyan: lightModeTextColor,
    brightWhite: "#ffffff",
  };
}

export function createTerminalTabLabel(tabIndex: number) {
  return tabIndex === 1 ? "Terminal" : `Terminal ${tabIndex}`;
}

export function createTerminalTabKey(workspaceKey: string, tabIndex: number) {
  return `${encodeURIComponent(workspaceKey)}${TERMINAL_TAB_KEY_SEPARATOR}${tabIndex}`;
}

export function getWorkspaceKeyFromTerminalTabKey(tabKey: string) {
  const separatorIndex = tabKey.indexOf(TERMINAL_TAB_KEY_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const encodedWorkspaceKey = tabKey.slice(0, separatorIndex);
  try {
    return decodeURIComponent(encodedWorkspaceKey);
  } catch {
    return null;
  }
}

export function resolveTerminalSessionWorkspaceRootPath(
  sessionWorkspaceRootPath: string | null | undefined,
) {
  const normalizedWorkspaceRootPath = sessionWorkspaceRootPath?.trim() ?? "";
  return normalizedWorkspaceRootPath.length > 0 ? normalizedWorkspaceRootPath : null;
}

export function reorderTabList<T extends { key: string }>(
  tabs: readonly T[],
  sourceTabKey: string,
  targetTabKey: string,
  position: "before" | "after",
): T[] {
  if (sourceTabKey === targetTabKey) {
    return [...tabs];
  }

  const sourceIndex = tabs.findIndex((tab) => tab.key === sourceTabKey);
  if (sourceIndex === -1) {
    return [...tabs];
  }

  const sourceTab = tabs[sourceIndex];
  const remainingTabs = tabs.filter((tab) => tab.key !== sourceTabKey);
  const targetIndexInRemaining = remainingTabs.findIndex((tab) => tab.key === targetTabKey);
  if (targetIndexInRemaining === -1) {
    return [...tabs];
  }

  const insertIndex =
    position === "before" ? targetIndexInRemaining : targetIndexInRemaining + 1;

  const nextTabs = [...remainingTabs];
  nextTabs.splice(insertIndex, 0, sourceTab);
  return nextTabs;
}

