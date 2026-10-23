import { handleWorkspaceTabStripWheel, WORKSPACE_TAB_ACTIONS_CLASS_NAME } from '../../ui/workspaceTabStrip';
import type { MouseEvent as ReactMouseEvent } from "react";
import { LoaderCircle, Plus, X, Maximize, Minimize, RotateCw, PanelRight, PanelBottom } from "lucide-react";
import { Tooltip } from "../../Tooltip";
import { AppNoticeSurface } from "../../ui/AppNoticeSurface";
import type { WorkspaceTerminalPanelState } from "./workspaceTerminalPanelTypes";
import { useWorkspaceTerminalTabDragDrop } from "./useWorkspaceTerminalTabDragDrop";

interface WorkspaceTerminalPanelViewProps {
  panelState: WorkspaceTerminalPanelState;
}

export function WorkspaceTerminalPanelView({
  panelState,
}: WorkspaceTerminalPanelViewProps) {
  const isRight = panelState.position === "right";
  const moveLabel = isRight ? "Move panel bottom" : "Move panel right";
  let panelBorderClass = "border-t border-border";
  if (panelState.isFullScreen) {
    panelBorderClass = "border-0";
  } else if (isRight) {
    panelBorderClass = "border-l border-border";
  }
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
        "non-selectable-ui relative flex min-h-0 min-w-0 shrink-0 self-stretch flex-col overflow-hidden bg-[var(--workspace-panel-surface)]",
        panelBorderClass,
      ].join(" ")}
      style={{
        display: panelState.isOpen ? undefined : "none",
        width: isRight && !panelState.isFullScreen ? panelState.panelWidth : "100%",
        height: isRight || panelState.isFullScreen ? "100%" : panelState.panelHeight,
        flex: panelState.isFullScreen ? 1 : "none",
      }}
    >
      {!panelState.isFullScreen ? (
        <button
          type="button"
          aria-label="Resize terminal panel"
          onPointerDown={panelState.handleResizePointerDown}
          className={[
            "absolute left-0 top-0 z-20",
            isRight ? "bottom-0 w-2 cursor-col-resize" : "right-0 h-2 cursor-row-resize",
          ].join(" ")}
        />
      ) : null}
      <div className="flex h-10 shrink-0 items-stretch border-b border-border bg-background">
        <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
          <div onWheel={handleWorkspaceTabStripWheel} className="workspace-tabs-scroll-viewport flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto overflow-y-hidden">
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
        <div data-terminal-tab-actions className={WORKSPACE_TAB_ACTIONS_CLASS_NAME}>
          <Tooltip content="Restart active terminal" side="bottom" noWrap>
            <button
              type="button"
              disabled={!activeTerminalTab || activeTerminalTab.status === "connecting"}
              onClick={() => {
                if (activeTerminalTab) {
                  void panelState.restartTerminalTab(activeTerminalTab.key);
                }
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Restart active terminal"
            >
              <RotateCw size={14} />
            </button>
          </Tooltip>
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
          {panelState.onPositionChange ? (
            <Tooltip content={moveLabel} side="bottom" noWrap>
              <button
                type="button"
                aria-label={moveLabel}
                onClick={() => panelState.onPositionChange?.(isRight ? "bottom" : "right")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
              >
                {isRight ? <PanelBottom size={14} /> : <PanelRight size={14} />}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden bg-[var(--workspace-panel-surface)] px-4 py-3">
        <div
          ref={panelState.terminalHostRef}
          className="selectable-ui workspace-terminal-host relative h-full w-full overflow-hidden text-foreground bg-[var(--workspace-panel-surface)]"
        />
        {!panelState.autoCreateTabOnOpen && panelState.terminalTabs.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="flex max-w-xs flex-col items-center text-center">
              <p className="text-sm font-medium text-foreground">No terminal sessions</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Start a terminal when you need one.</p>
              <button
                type="button"
                onClick={() => void panelState.openTerminalTab()}
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground hover:bg-action-hover"
              >
                <Plus size={15} />
                New terminal
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {activeTerminalTab?.status === "error" &&
      activeTerminalTab.errorMessage ? (
        <div className="border-t border-border p-2">
          <AppNoticeSurface
            operation="terminal.start"
            title="Terminal unavailable"
            message={activeTerminalTab.errorMessage}
            fallbackMessage="The terminal session could not be started. Restart it to try again."
            action={{ label: "Restart", onClick: () => void panelState.restartTerminalTab(activeTerminalTab.key) }}
          />
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
            className="rounded bg-surface-hover px-2 py-0.5 font-medium transition-colors hover:bg-surface-pressed hover:text-foreground"
          >
            Restart Terminal
          </button>
        </div>
      ) : null}
    </section>
  );
}
