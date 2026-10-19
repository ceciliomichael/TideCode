import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  getChatPanelBounds,
  type ChatPanelBounds,
} from "../../lib/chatPanelSizing";
import { clampWorkspacePanelWidth } from "../../lib/workspacePanelSizing";

export function useResizableChatPanel() {
  const [chatPanelBounds, setChatPanelBounds] = useState<ChatPanelBounds>(() =>
    getChatPanelBounds(window.innerWidth),
  );
  const [chatPanelWidth, setChatPanelWidth] = useState(
    chatPanelBounds.maxWidth,
  );
  const chatPanelWidthRef = useRef(chatPanelWidth);
  const chatResizeDragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const chatResizeRafRef = useRef<number | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const isChatResizingRef = useRef(false);

  function clampWidth(width: number) {
    const bounds = getChatPanelBounds(window.innerWidth);
    const panel = chatPanelRef.current;
    if (!panel) {
      return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, width));
    }
    // Never compress the composer, even when a window is narrower than all panels.
    return Math.max(bounds.minWidth, clampWorkspacePanelWidth(panel, width, bounds.minWidth, bounds.maxWidth));
  }

  useLayoutEffect(() => {
    const parent = chatPanelRef.current?.parentElement;
    function handleWindowResize() {
      if (isChatResizingRef.current) {
        return;
      }
      setChatPanelBounds(getChatPanelBounds(window.innerWidth));
      setChatPanelWidth((width) => clampWidth(width));
    }
    handleWindowResize();
    const observer = new ResizeObserver(handleWindowResize);
    if (parent) {
      observer.observe(parent);
    }
    window.addEventListener("resize", handleWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = chatResizeDragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      chatPanelWidthRef.current = clampWidth(drag.startWidth + (event.clientX - drag.startX));
      if (chatResizeRafRef.current !== null) return;

      chatResizeRafRef.current = window.requestAnimationFrame(() => {
        chatResizeRafRef.current = null;
        if (chatPanelRef.current) {
          chatPanelRef.current.style.width = `${chatPanelWidthRef.current}px`;
        }
      });
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = chatResizeDragStateRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      chatResizeDragStateRef.current = null;
      isChatResizingRef.current = false;
      if (chatResizeRafRef.current !== null) {
        window.cancelAnimationFrame(chatResizeRafRef.current);
        chatResizeRafRef.current = null;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (chatPanelRef.current) {
        chatPanelRef.current.style.width = `${chatPanelWidthRef.current}px`;
      }
      setChatPanelWidth(chatPanelWidthRef.current);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (isChatResizingRef.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      if (chatResizeRafRef.current !== null) {
        window.cancelAnimationFrame(chatResizeRafRef.current);
        chatResizeRafRef.current = null;
      }
    };
  }, []);

  function handleChatResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) return;

    chatPanelWidthRef.current =
      chatPanelRef.current?.offsetWidth ?? chatPanelWidth;
    chatResizeDragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: chatPanelWidthRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    isChatResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return {
    chatPanelMaxWidth: chatPanelBounds.maxWidth,
    chatPanelMinWidth: chatPanelBounds.minWidth,
    chatPanelRef,
    chatPanelWidth,
    handleChatResizePointerDown,
  };
}
