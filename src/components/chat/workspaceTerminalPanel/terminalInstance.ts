import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type IDisposable } from "@xterm/xterm";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { pasteTextIntoTerminal } from "./terminalPaste";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";
import {
  clearSelectionWithinHost,
  copyTerminalSelectionToClipboard,
  getErrorMessage,
  getNativeSelectionTextWithinHost,
  getSessionDimensions,
  getTerminalTheme,
} from "./workspaceTerminalPanelUtils";

export interface TabTerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  webLinksAddon: WebLinksAddon;
  container: HTMLDivElement;
  disposables: IDisposable[];
  lastSyncedSize?: { cols: number; rows: number };
}

interface CreateTerminalInstanceInput {
  activeTabKey: string | null;
  getWorkspaceRootPath: (tabKey: string) => string | null;
  hostElement: HTMLDivElement | null;
  resolvedTheme: "light" | "dark";
  restartTab: (tabKey: string) => void;
  sendTerminalSize: (
    tabKey: string,
    sessionId: number,
    dimensions: { cols: number; rows: number },
  ) => void;
  sessionIdToTabKeyRef: MutableRefObject<Map<number, string>>;
  setTerminalTabs: Dispatch<SetStateAction<TerminalTabState[]>>;
  tabKey: string;
  terminalTabsRef: MutableRefObject<TerminalTabState[]>;
}

function createContainer(tabKey: string, activeTabKey: string | null) {
  const container = document.createElement("div");
  container.className = "workspace-terminal-tab-instance";
  Object.assign(container.style, {
    display: tabKey === activeTabKey ? "block" : "none",
    height: "100%",
    left: "0",
    overflow: "hidden",
    position: "absolute",
    top: "0",
    width: "100%",
  });
  return container;
}

export function createTerminalInstance({
  activeTabKey,
  getWorkspaceRootPath,
  hostElement,
  resolvedTheme,
  restartTab,
  sendTerminalSize,
  sessionIdToTabKeyRef,
  setTerminalTabs,
  tabKey,
  terminalTabsRef,
}: CreateTerminalInstanceInput): TabTerminalInstance {
  const container = createContainer(tabKey, activeTabKey);
  hostElement?.appendChild(container);

  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.24,
    minimumContrastRatio: 4.5,
    scrollback: 5_000,
    theme: getTerminalTheme(hostElement || document.body, resolvedTheme),
  });
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon((event, uri) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    void window.tidecodeTerminal.openExternalLink({ url: uri }).catch((error: unknown) => {
      console.error("Failed to open terminal link", error);
    });
  });
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(container);

  const clearTerminalInputSelection = () => {
    terminal.clearSelection();
    clearSelectionWithinHost(container);
  };

  const handleTerminalContextMenu = (event: MouseEvent) => {
    const selection = terminal.getSelection() || getNativeSelectionTextWithinHost(container);
    event.preventDefault();
    if (selection) {
      void copyTerminalSelectionToClipboard({ hostElement: container, terminal })
        .catch((error: unknown) => console.error("Failed to copy selected terminal text", error))
        .finally(() => {
          clearTerminalInputSelection();
        });
      return;
    }
    void navigator.clipboard.readText()
      .then((text) => pasteTextIntoTerminal(terminal, text))
      .catch((error: unknown) => console.error("Failed to read clipboard for paste", error));
  };
  container.addEventListener("contextmenu", handleTerminalContextMenu);

  const writeSequence = (sequence: string) => {
    clearTerminalInputSelection();
    const tab = terminalTabsRef.current.find((candidate) => candidate.key === tabKey);
    if (tab?.sessionId === null || tab?.sessionId === undefined) return;
    void window.tidecodeTerminal.writeToSession({
      data: sequence,
      sessionId: tab.sessionId,
      workspaceRootPath: getWorkspaceRootPath(tabKey),
    }).catch(console.error);
  };

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown") {
      if (event.key === "Enter" && (event.shiftKey || event.altKey)) {
        writeSequence("\x1b\r");
        return false;
      }
      if (event.key === "Backspace") {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
          writeSequence("\x17");
          return false;
        }
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          writeSequence("\x1b\x7f");
          return false;
        }
      }
      if (event.key === "Delete" &&
          (event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey) {
        writeSequence("\x1bd");
        return false;
      }
      if (event.key === "ArrowLeft" &&
          (event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey) {
        writeSequence("\x1bb");
        return false;
      }
      if (event.key === "ArrowRight" &&
          (event.ctrlKey || event.metaKey || event.altKey) && !event.shiftKey) {
        writeSequence("\x1bf");
        return false;
      }
      const isClearShortcut = (event.ctrlKey || event.metaKey) &&
        !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
      if (isClearShortcut) {
        terminal.clear();
        return false;
      }
      const isPasteShortcut = ((event.ctrlKey || event.metaKey) &&
        !event.altKey && event.key.toLowerCase() === "v") ||
        (event.shiftKey && event.key === "Insert");
      if (isPasteShortcut) {
        event.preventDefault();
        void navigator.clipboard.readText()
          .then((text) => pasteTextIntoTerminal(terminal, text))
          .catch(console.error);
        return false;
      }
    }

    const isCopyShortcut = (event.ctrlKey || event.metaKey) &&
      !event.altKey && event.key.toLowerCase() === "c";
    if (!isCopyShortcut) return true;
    const selection = terminal.getSelection() || getNativeSelectionTextWithinHost(container);
    if (!selection) return true;
    void navigator.clipboard.writeText(selection).catch(console.error);
    return false;
  });

  const disposables: IDisposable[] = [
    terminal.onData((data) => {
      // xterm keeps its selection visible after browser text input. Clear both
      // xterm and native DOM selection before forwarding the input to the PTY.
      clearTerminalInputSelection();
      const tab = terminalTabsRef.current.find((candidate) => candidate.key === tabKey);
      if (tab?.sessionId === null || tab?.sessionId === undefined) {
        if (tab?.status === "exited" && (data === "\r" || data === "\n")) restartTab(tabKey);
        return;
      }
      const sessionId = tab.sessionId;
      void window.tidecodeTerminal.writeToSession({
        data,
        sessionId,
        workspaceRootPath: getWorkspaceRootPath(tabKey),
      }).catch((error: unknown) => {
        const errorMessage = getErrorMessage(error);
        const sessionEnded = errorMessage.includes("Unknown terminal session id") ||
          errorMessage.includes("already exited") || errorMessage.includes("does not belong");
        if (!sessionEnded) {
          console.error(`Failed to write terminal input for tab ${tabKey}`, error);
          return;
        }
        sessionIdToTabKeyRef.current.delete(sessionId);
        setTerminalTabs((currentTabs) => currentTabs.map((candidate) =>
          candidate.key === tabKey
            ? { ...candidate, errorMessage: null, exitCode: candidate.exitCode ?? 0,
                sessionId: null, status: "exited" }
            : candidate,
        ));
        terminal.writeln(
          "\r\n\r\n[Terminal session ended. Press Enter or click Restart to reconnect.]",
        );
      });
    }),
    terminal.onResize(() => {
      const tab = terminalTabsRef.current.find((candidate) => candidate.key === tabKey);
      if (tab?.sessionId !== null && tab?.sessionId !== undefined) {
        sendTerminalSize(tabKey, tab.sessionId, getSessionDimensions(terminal));
      }
    }),
  ];

  return { container, disposables, fitAddon, terminal, webLinksAddon };
}

export function disposeTerminalInstance(instance: TabTerminalInstance) {
  instance.disposables.forEach((disposable) => disposable.dispose());
  instance.terminal.dispose();
  instance.container.remove();
}
