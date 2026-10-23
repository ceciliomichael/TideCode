import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MAX_TERMINAL_PANEL_HEIGHT, clampStoredTerminalPanelHeight } from "../../../lib/terminalPanelSizing";
import { MIN_CHAT_PANEL_WIDTH } from "../../../lib/chatPanelSizing";
import { getMaxDiffPanelWidth, getMinDiffPanelWidth } from "../../../lib/diffPanelSizing";
import { clampWorkspacePanelWidth } from "../../../lib/workspacePanelSizing";
import { clampPanelHeight } from "./workspaceTerminalPanelUtils";
import type { TerminalPanelPosition } from "./workspaceTerminalPanelTypes";

interface UseWorkspaceTerminalPanelSizingArgs {
  isOpen: boolean;
  isFullScreen?: boolean;
  position: TerminalPanelPosition;
  onHeightCommit: (height: number) => void;
  storedHeight: number;
  panelWidth: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
}

export function useWorkspaceTerminalPanelSizing(args: UseWorkspaceTerminalPanelSizingArgs) {
  const { isOpen, isFullScreen, position, storedHeight, panelWidth: storedWidth } = args;
  const panelRef = useRef<HTMLElement | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;
  const [panelHeight, setPanelHeight] = useState(clampStoredTerminalPanelHeight(storedHeight));
  const [panelWidth, setPanelWidth] = useState(storedWidth);
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    position: TerminalPanelPosition;
    startCoordinate: number;
    startSize: number;
    size: number;
  } | null>(null);
  const frameRef = useRef<number | null>(null);

  const clampSize = useCallback((size: number, dock: TerminalPanelPosition) => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (dock === "right" && panel && parent) {
      if (parent.hasAttribute("data-terminal-dock-container") && parent.dataset.fixedWidth === "true") {
        const chat = parent.querySelector<HTMLElement>("[data-chat-panel]");
        const chatWidth = chat?.getBoundingClientRect().width ?? MIN_CHAT_PANEL_WIDTH;
        const workspaceWidth = parent.parentElement?.clientWidth ?? parent.clientWidth;
        const totalWidth = clampWorkspacePanelWidth(
          parent,
          size + chatWidth,
          chatWidth + getMinDiffPanelWidth(workspaceWidth),
          chatWidth + getMaxDiffPanelWidth(workspaceWidth),
        );
        return Math.max(0, totalWidth - chatWidth);
      }
      return clampWorkspacePanelWidth(panel, size, getMinDiffPanelWidth(parent.clientWidth), getMaxDiffPanelWidth(parent.clientWidth));
    }
    let maxHeight = MAX_TERMINAL_PANEL_HEIGHT;
    if (parent?.clientHeight) {
      maxHeight = Math.min(maxHeight, Math.floor(parent.clientHeight * 0.78));
    }
    return clampPanelHeight(size, maxHeight);
  }, []);

  const applySize = useCallback((size: number, dock: TerminalPanelPosition) => {
    if (dock === "right") {
      setPanelWidth(size);
      argsRef.current.onWidthChange?.(size);
    } else {
      setPanelHeight(size);
    }
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!isOpen || isFullScreen || !panel || !parent) {
      return;
    }
    function updateBounds() {
      if (dragRef.current) {
        return;
      }
      const current = argsRef.current;
      const size = current.position === "right" ? current.panelWidth : current.storedHeight;
      applySize(clampSize(size, current.position), current.position);
    }
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(parent);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [isOpen, isFullScreen, position, storedHeight, storedWidth, applySize, clampSize]);

  useEffect(() => {
    function cancelFrame() {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    }
    function handleMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      const coordinate = drag.position === "right" ? event.clientX : event.clientY;
      drag.size = clampSize(drag.startSize + drag.startCoordinate - coordinate, drag.position);
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        applySize(drag.size, drag.position);
      });
    }
    function handleEnd(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      cancelFrame();
      applySize(drag.size, drag.position);
      dragRef.current = null;
      setIsResizing(false);
      if (drag.position === "right") {
        argsRef.current.onWidthCommit?.(drag.size);
      } else {
        argsRef.current.onHeightCommit(drag.size);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      cancelFrame();
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, [applySize, clampSize]);

  function handleResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isOpen || isFullScreen || event.button !== 0) {
      return;
    }
    const size = position === "right" ? panelWidth : panelHeight;
    dragRef.current = {
      pointerId: event.pointerId,
      position,
      startCoordinate: position === "right" ? event.clientX : event.clientY,
      startSize: size,
      size,
    };
    setIsResizing(true);
    document.body.style.cursor = position === "right" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  return { handleResizePointerDown, isOpen, isResizing, panelHeight, panelWidth, panelRef };
}
