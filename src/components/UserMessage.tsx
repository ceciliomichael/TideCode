import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Undo2 } from "lucide-react";
import {
  chatConversationSurfacePaddingClassName,
  chatMessageSurfaceClassName,
} from "../lib/chatStyles";
import { Tooltip } from "./Tooltip";
import { ChatMentionText } from "./chat/ChatMentionText";
import { parseCompressedHistoryMessage } from "../lib/chatCompression";
import { CompressedHistoryMessage } from "./chat/CompressedHistoryMessage";

interface UserMessageProps {
  content: string;
  onEdit?: () => void;
  onRevert?: () => void;
}

export function UserMessage({ content, onEdit, onRevert }: UserMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const textEndRef = useRef<HTMLSpanElement>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  const [isOverlapping, setIsOverlapping] = useState(false);
  const trimmedContent = content.trim();
  const compressedHistoryMessage = useMemo(
    () => parseCompressedHistoryMessage(content),
    [content],
  );
  const isCompressedHistoryMessage = compressedHistoryMessage !== null;
  const contentClampClassName = "line-clamp-10 overflow-hidden";

  const surfaceClassName = [
    chatMessageSurfaceClassName,
    `relative group inline-flex w-fit min-w-0 max-w-full overflow-hidden ${chatConversationSurfacePaddingClassName} text-[15px] leading-6 text-foreground align-top`,
    onEdit ? "cursor-pointer" : "",
  ].join(" ");

  useLayoutEffect(() => {
    if (isCompressedHistoryMessage) {
      setIsMultiline(false);
      setIsOverlapping(false);
      return;
    }

    const contentElement = contentRef.current;
    if (!contentElement || trimmedContent.length === 0) {
      setIsMultiline(false);
      setIsOverlapping(false);
      return;
    }

    const updateMultilineState = () => {
      const lineHeight = Number.parseFloat(
        window.getComputedStyle(contentElement).lineHeight,
      );
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        setIsMultiline(false);
        setIsOverlapping(false);
        return;
      }

      setIsMultiline(
        contentElement.getBoundingClientRect().height > lineHeight * 1.5,
      );

      const endElement = textEndRef.current;
      if (endElement) {
        const endRect = endElement.getBoundingClientRect();
        const containerRect = contentElement.getBoundingClientRect();
        // ~48px threshold ensures we detect overlap before text hits the revert button
        setIsOverlapping(endRect.right > containerRect.right - 48);
      }
    };

    updateMultilineState();

    const resizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            updateMultilineState();
          })
        : null;

    resizeObserver?.observe(contentElement);

    return () => {
      resizeObserver?.disconnect();
    };
  }, [isCompressedHistoryMessage, trimmedContent]);

  if (compressedHistoryMessage) {
    return (
      <div className="w-full min-w-0 max-w-full">
        <CompressedHistoryMessage summary={compressedHistoryMessage.summary} />
      </div>
    );
  }

  const handleSurfaceClick = () => {
    onEdit?.();
  };

  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onEdit?.();
    }
  };

  const handleUndoClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRevert?.();
  };

  const buttonPositionClassName = isMultiline
    ? "right-0 bottom-0 h-9"
    : "right-0 top-0 bottom-0";

  return (
    <div
      className={surfaceClassName}
      onClick={onEdit ? handleSurfaceClick : undefined}
      onKeyDown={onEdit ? handleSurfaceKeyDown : undefined}
      role={onEdit ? "button" : undefined}
      tabIndex={onEdit ? 0 : undefined}
      aria-label={onEdit ? "Edit message" : undefined}
    >
      <div
        ref={contentRef}
        className={`min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${contentClampClassName}`}
      >
        {trimmedContent.length > 0 ? (
          <ChatMentionText text={content} variant="rendered" />
        ) : null}
        <span ref={textEndRef} aria-hidden="true" />
      </div>

      {onRevert ? (
        <Tooltip content="Revert and edit this message" side="right">
          <div
            className={`absolute ${buttonPositionClassName} invisible z-10 flex items-center justify-end opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100`}
          >
            <div className="h-full w-6 bg-gradient-to-r from-transparent to-surface" />
            <div className="flex h-full items-center bg-surface pr-3">
              {isOverlapping ? (
                <span className="mr-1.5 select-none text-[15px] font-normal leading-6 tracking-widest text-foreground">
                  ...
                </span>
              ) : null}
              <button
                type="button"
                onClick={handleUndoClick}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                aria-label="Revert and edit this message"
              >
                <Undo2 size={13} />
              </button>
            </div>
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}
