import type { MouseEvent as ReactMouseEvent } from "react";
import { LoaderCircle, Plus, X, Maximize, Minimize } from "lucide-react";
import { Tooltip } from "../../Tooltip";
import type { WorkspaceTerminalPanelState } from "./workspaceTerminalPanelTypes";
import { useWorkspaceTerminalTabDragDrop } from "./useWorkspaceTerminalTabDragDrop";

interface WorkspaceTerminalPanelViewProps {
  panelState: WorkspaceTerminalPanelState;
}

export function WorkspaceTerminalPanelView({
  panelState,
}: WorkspaceTerminalPanelViewProps) {
  const activeTerminalTab = panelState.activeTerminalTab;
  const { draggedTabKey, dragOverTabKey, dropPosition, getTabDragHandlers } =
    useWorkspaceTerminalTabDragDrop({
      reorderTerminalTabs: panelState.reorderTerminalTabs,
    });

  const handleTerminalTabMouseDown = (
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  const handleTerminalTabAuxClick = (
    event: ReactMouseEvent<HTMLButtonElement>,
    tabKey: string,
  ) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    void panelState.closeTerminalTab(tabKey);
  };

  return (
    <section
      ref={panelState.panelRef}
      className={[
        "relative flex min-h-0 w-full shrink-0 self-stretch flex-col overflow-hidden border-t border-border bg-[var(--workspace-panel-surface)]",
      ].join(" ")}
      style={{
        borderTopColor: panelState.isOpen && !panelState.isFullScreen ? "var(--color-border)" : "transparent",
        height: panelState.isOpen ? (panelState.isFullScreen ? "100%" : panelState.panelHeight) : 0,
        flex: panelState.isOpen && panelState.isFullScreen ? 1 : "none",
      }}
    >
      {!panelState.isFullScreen ? (
        <button
          type="button"
          aria-label="Resize terminal panel"
          onPointerDown={panelState.handleResizePointerDown}
          className={[
            "absolute left-0 right-0 top-0 z-20 h-2",
            panelState.isOpen ? "cursor-row-resize" : "cursor-default",
          ].join(" ")}
        />
      ) : null}
      <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-background">
        <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
          <div className="workspace-tabs-scroll-viewport flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto overflow-y-hidden">
            {panelState.terminalTabs.map((tab) => {
              const isActive = tab.key === panelState.activeTerminalTabKey;
              const isDragging = draggedTabKey === tab.key;
              const isDragOver = dragOverTabKey === tab.key && !isDragging;
              const dragHandlers = getTabDragHandlers(tab.key);

              return (
                <div
                  key={tab.key}
                  {...dragHandlers}
                  className={[
                    "group relative inline-flex h-full shrink-0 items-stretch border-r border-border transition-opacity select-none cursor-grab active:cursor-grabbing",
                    isDragging ? "opacity-40" : "opacity-100",
                  ].join(" ")}
                >
                  {isDragOver && dropPosition === "before" ? (
                    <div className="absolute left-0 top-0 bottom-0 z-30 w-0.5 bg-brand" />
                  ) : null}
                  {isDragOver && dropPosition === "after" ? (
                    <div className="absolute right-0 top-0 bottom-0 z-30 w-0.5 bg-brand" />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => panelState.selectTerminalTab(tab.key)}
                    onMouseDown={handleTerminalTabMouseDown}
                    onAuxClick={(event) => handleTerminalTabAuxClick(event, tab.key)}
                    className={[
                      "inline-flex h-full min-w-[128px] max-w-[320px] items-center gap-2 px-3 pr-9 text-sm transition-colors cursor-grab active:cursor-grabbing",
                      isActive
                        ? "border-t-2 border-t-foreground/60 bg-background text-foreground"
                        : "border-t-2 border-t-transparent bg-background text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                    ].join(" ")}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="truncate">{tab.label}</span>
                    {tab.status === "connecting" ? (
                      <LoaderCircle size={12} className="shrink-0 animate-spin" />
                    ) : null}
                  </button>
                  <Tooltip content={`Close ${tab.label}`} side="bottom" noWrap>
                    <button
                      type="button"
                      onClick={() => {
                        void panelState.closeTerminalTab(tab.key);
                      }}
                      className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Close ${tab.label}`}
                    >
                      <X size={14} />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 border-l border-border px-2">
          <Tooltip content="New terminal tab" side="bottom" noWrap>
            <button
              type="button"
              onClick={() => {
                void panelState.openTerminalTab();
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
              aria-label="New terminal tab"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
          {panelState.onFullScreenChange ? (
            <Tooltip content={panelState.isFullScreen ? "Exit full screen" : "Full screen"} side="bottom" noWrap>
              <button
                type="button"
                onClick={() => panelState.onFullScreenChange?.(!panelState.isFullScreen)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
                aria-label={panelState.isFullScreen ? "Exit full screen" : "Full screen"}
              >
                {panelState.isFullScreen ? <Minimize size={14} /> : <Maximize size={14} />}
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content="Close terminal panel" side="bottom" noWrap>
            <button
              type="button"
              onClick={panelState.onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
              aria-label="Close terminal panel"
            >
              <X size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden bg-[var(--workspace-panel-surface)] px-4 py-3">
        <div
          ref={panelState.terminalHostRef}
          className="workspace-terminal-host relative h-full w-full overflow-hidden text-foreground bg-[var(--workspace-panel-surface)]"
        />
      </div>
      {activeTerminalTab?.status === "error" &&
      activeTerminalTab.errorMessage ? (
        <div className="flex items-center justify-between border-t border-danger-border bg-danger-surface px-4 py-1.5 text-xs text-danger-foreground">
          <span>{activeTerminalTab.errorMessage}</span>
          <button
            type="button"
            onClick={() => void panelState.restartTerminalTab(activeTerminalTab.key)}
            className="rounded bg-danger-foreground/10 px-2 py-0.5 font-medium transition-colors hover:bg-danger-foreground/20"
          >
            Restart
          </button>
        </div>
      ) : null}
      {activeTerminalTab?.status === "exited" ? (
        <div className="flex items-center justify-between border-t border-border bg-surface-muted px-4 py-1.5 text-xs text-muted-foreground">
          <span>
            {activeTerminalTab.exitCode !== null
              ? `Process exited with code ${activeTerminalTab.exitCode}`
              : "Terminal session ended"}
          </span>
          <button
            type="button"
            onClick={() => void panelState.restartTerminalTab(activeTerminalTab.key)}
            className="rounded bg-surface-muted-hover px-2 py-0.5 font-medium transition-colors hover:text-foreground"
          >
            Restart Terminal
          </button>
        </div>
      ) : null}
    </section>
  );
}
