import { useCallback, useEffect, type MutableRefObject, type RefObject } from "react";
import type { TabTerminalInstance } from "./terminalInstance";
import type { TerminalTabState } from "./workspaceTerminalPanelTypes";
import {
  getSessionDimensions,
  getTerminalTheme,
  isRenderableTerminalDimensions,
} from "./workspaceTerminalPanelUtils";

const TERMINAL_LAYOUT_SYNC_DELAY_MS = 200;

interface UseTerminalSizingOptions {
  activeTerminalTabKey: string | null;
  activeTabKeyRef: MutableRefObject<string | null>;
  getWorkspaceRootPath: (tabKey?: string | null) => string | null;
  isOpen: boolean;
  isResizing: boolean;
  isResizingRef: MutableRefObject<boolean>;
  resolvedTheme: "light" | "dark";
  tabInstancesRef: MutableRefObject<Map<string, TabTerminalInstance>>;
  terminalHostRef: RefObject<HTMLDivElement>;
  terminalTabsRef: MutableRefObject<TerminalTabState[]>;
  workspaceKey: string;
}

export function useTerminalSizing({
  activeTerminalTabKey,
  activeTabKeyRef,
  getWorkspaceRootPath,
  isOpen,
  isResizing,
  isResizingRef,
  resolvedTheme,
  tabInstancesRef,
  terminalHostRef,
  terminalTabsRef,
  workspaceKey,
}: UseTerminalSizingOptions) {
  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing, isResizingRef]);

  const sendTerminalSizeToSession = useCallback(
    (tabKey: string, sessionId: number, dimensions: { cols: number; rows: number }) => {
      const instance = tabInstancesRef.current.get(tabKey);
      if (!instance) {
        return;
      }
      if (
        instance.lastSyncedSize?.cols === dimensions.cols &&
        instance.lastSyncedSize.rows === dimensions.rows
      ) {
        return;
      }

      instance.lastSyncedSize = { cols: dimensions.cols, rows: dimensions.rows };
      void window.echosphereTerminal
        .resizeSession({
          cols: dimensions.cols,
          rows: dimensions.rows,
          sessionId,
          workspaceRootPath: getWorkspaceRootPath(tabKey),
        })
        .catch((error) => {
          instance.lastSyncedSize = undefined;
          console.error(`Failed to sync terminal size for tab ${tabKey}`, error);
        });
    },
    [getWorkspaceRootPath, tabInstancesRef],
  );

  const syncTabSize = useCallback(
    (tabKey: string, force = false) => {
      if (!force && isResizingRef.current) {
        return false;
      }

      const instance = tabInstancesRef.current.get(tabKey);
      if (!instance) {
        return false;
      }
      const proposedDimensions = instance.fitAddon.proposeDimensions();
      if (!isRenderableTerminalDimensions(proposedDimensions)) {
        return false;
      }

      instance.fitAddon.fit();
      const tab = terminalTabsRef.current.find((candidate) => candidate.key === tabKey);
      if (tab?.sessionId !== null && tab?.sessionId !== undefined) {
        sendTerminalSizeToSession(tabKey, tab.sessionId, getSessionDimensions(instance.terminal));
      }
      return true;
    },
    [isResizingRef, sendTerminalSizeToSession, tabInstancesRef, terminalTabsRef],
  );

  const syncAllVisibleTabSizes = useCallback(
    (force = false) => {
      if (!isOpen || (!force && isResizingRef.current)) {
        return;
      }
      const activeKey = activeTabKeyRef.current;
      if (activeKey) {
        syncTabSize(activeKey, force);
      }
    },
    [activeTabKeyRef, isOpen, isResizingRef, syncTabSize],
  );

  const syncTerminalTheme = useCallback(() => {
    const hostElement = terminalHostRef.current || document.body;
    const theme = getTerminalTheme(hostElement, resolvedTheme);
    tabInstancesRef.current.forEach((instance) => {
      instance.terminal.options.theme = { ...theme };
      instance.terminal.refresh(0, Math.max(instance.terminal.rows - 1, 0));
    });
  }, [resolvedTheme, tabInstancesRef, terminalHostRef]);

  useEffect(() => {
    if (!terminalHostRef.current) {
      return;
    }
    const animationFrameId = window.requestAnimationFrame(syncTerminalTheme);
    const timeoutId = window.setTimeout(syncTerminalTheme, TERMINAL_LAYOUT_SYNC_DELAY_MS);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [syncTerminalTheme, terminalHostRef]);

  useEffect(() => {
    if (!isOpen || isResizing) {
      return;
    }
    const syncSizes = () => syncAllVisibleTabSizes(true);
    const animationFrameId = window.requestAnimationFrame(syncSizes);
    const timeoutId = window.setTimeout(syncSizes, TERMINAL_LAYOUT_SYNC_DELAY_MS);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.clearTimeout(timeoutId);
    };
  }, [activeTerminalTabKey, isOpen, isResizing, syncAllVisibleTabSizes, workspaceKey]);

  useEffect(() => {
    if (!isOpen || !terminalHostRef.current) {
      return;
    }
    const resizeObserver = new ResizeObserver(() => syncAllVisibleTabSizes());
    resizeObserver.observe(terminalHostRef.current);
    return () => resizeObserver.disconnect();
  }, [isOpen, syncAllVisibleTabSizes, terminalHostRef]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleWindowResize = () => syncAllVisibleTabSizes();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isOpen, syncAllVisibleTabSizes]);

  return {
    sendTerminalSizeToSession,
    syncAllVisibleTabSizes,
    syncTabSize,
  };
}
