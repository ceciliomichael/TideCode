import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  MAX_TERMINAL_PANEL_HEIGHT,
  clampStoredTerminalPanelHeight,
} from "../../../lib/terminalPanelSizing";
import { clampPanelHeight } from "./workspaceTerminalPanelUtils";

interface UseWorkspaceTerminalPanelSizingArgs {
  isOpen: boolean;
  onHeightCommit: (nextHeight: number) => void;
  storedHeight: number;
}

interface WorkspaceTerminalPanelSizingState {
  handleResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  isOpen: boolean;
  isResizing: boolean;
  panelHeight: number;
  panelRef: RefObject<HTMLElement>;
}

export function useWorkspaceTerminalPanelSizing({
  isOpen,
  onHeightCommit,
  storedHeight,
}: UseWorkspaceTerminalPanelSizingArgs): WorkspaceTerminalPanelSizingState {
  const panelRef = useRef<HTMLElement | null>(null);
  const resizeStateRef = useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);
  const resizeAnimationFrameRef = useRef<number | null>(null);
  const pendingResizeHeightRef = useRef<number | null>(null);
  const onHeightCommitRef = useRef(onHeightCommit);
  const panelHeightRef = useRef(clampStoredTerminalPanelHeight(storedHeight));
  const isResizingRef = useRef(false);
  const [panelHeight, setPanelHeight] = useState(panelHeightRef.current);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    onHeightCommitRef.current = onHeightCommit;
  }, [onHeightCommit]);

  useEffect(() => {
    panelHeightRef.current = panelHeight;
  }, [panelHeight]);

  const getMaxPanelHeight = useCallback(() => {
    const parentHeight = panelRef.current?.parentElement?.clientHeight;
    if (!parentHeight) {
      return MAX_TERMINAL_PANEL_HEIGHT;
    }

    return Math.min(MAX_TERMINAL_PANEL_HEIGHT, Math.floor(parentHeight * 0.78));
  }, []);

  useEffect(() => {
    isResizingRef.current = isResizing;
  }, [isResizing]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const maxHeightLimit = getMaxPanelHeight();
    setPanelHeight((currentValue) =>
      clampPanelHeight(currentValue, maxHeightLimit),
    );
  }, [getMaxPanelHeight, isOpen]);

  useLayoutEffect(() => {
    if (isResizing) {
      return;
    }

    const maxHeightLimit = getMaxPanelHeight();
    const nextHeight = clampPanelHeight(storedHeight, maxHeightLimit);
    panelHeightRef.current = nextHeight;
    setPanelHeight(nextHeight);
  }, [getMaxPanelHeight, isResizing, storedHeight]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleWindowResize = () => {
      const maxHeightLimit = getMaxPanelHeight();
      setPanelHeight((currentValue) =>
        clampPanelHeight(currentValue, maxHeightLimit),
      );
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [getMaxPanelHeight, isOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const maxHeightLimit = getMaxPanelHeight();
      const nextHeight = clampPanelHeight(
        resizeState.startHeight + (resizeState.startY - event.clientY),
        maxHeightLimit,
      );
      pendingResizeHeightRef.current = nextHeight;
      if (resizeAnimationFrameRef.current !== null) {
        return;
      }

      resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
        resizeAnimationFrameRef.current = null;
        const pendingHeight = pendingResizeHeightRef.current;
        if (pendingHeight === null) {
          return;
        }

        setPanelHeight(pendingHeight);
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (resizeStateRef.current?.pointerId !== event.pointerId) {
        return;
      }

      let committedHeight = panelHeightRef.current;
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current);
        resizeAnimationFrameRef.current = null;
      }
      if (pendingResizeHeightRef.current !== null) {
        committedHeight = pendingResizeHeightRef.current;
        setPanelHeight(committedHeight);
      }
      pendingResizeHeightRef.current = null;

      resizeStateRef.current = null;
      isResizingRef.current = false;
      setIsResizing(false);
      onHeightCommitRef.current(committedHeight);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current);
        resizeAnimationFrameRef.current = null;
      }
      pendingResizeHeightRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [getMaxPanelHeight]);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!isOpen || event.button !== 0) {
        return;
      }

      resizeStateRef.current = {
        pointerId: event.pointerId,
        startHeight: panelHeight,
        startY: event.clientY,
      };
      setIsResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [isOpen, panelHeight],
  );

  return {
    handleResizePointerDown,
    isOpen,
    isResizing,
    panelHeight,
    panelRef,
  };
}
