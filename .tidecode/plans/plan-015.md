---
status: implementation_started
---

# Move new-thread control to the sidebar header row

## Goal
Place the “choose a project for a new thread” control on the same top row as the collapse/open-sidebar control, aligned to the sidebar’s right edge on desktop, while preserving the existing collapsed-sidebar access and mobile behavior.

## Findings
- `SidebarPanel` currently renders the `SquarePen` button beside thread search, with project-dependent tooltip text.
- `WorkspaceFloatingControls` owns the collapse button and currently shows its optional new-thread button only while the sidebar is closed.
- `ChatInterfaceContent` supplies the new-thread callback and already receives the persisted `sidebarWidth`; settings uses the same shared floating-control component without a new-thread action.
- Desktop sidebar width is controlled by `ResizableSidebarPanel`, so the floating control can align to the actual configured width without changing sidebar layout. No focused component tests currently cover these controls.

## Implementation
1. Remove the duplicate new-thread button and its now-unused icon/tooltip dependency from `SidebarPanel`, leaving search and project controls in their existing layout.
2. Update `WorkspaceFloatingControls` to accept the desktop sidebar width and position the new-thread button:
   - when open, at the sidebar’s right edge on the same top row as the collapse button;
   - when closed, retain the current floating placement/accessibility behavior.
   - Keep the control hidden/disabled appropriately for pages that do not provide a new-thread action, and keep mobile behavior unchanged.
3. Pass `sidebarWidth` from `ChatInterfaceContent` to the shared floating controls. Do not alter the settings screen’s controls.

## Verification
- Run the project’s typecheck/lint/build or the narrowest available checks from `package.json`.
- Confirm there is one new-thread control in the desktop chat header row, it tracks sidebar resizing, the tooltip/aria label remains correct, and the control remains usable when the sidebar is collapsed.
- Confirm settings and mobile layouts do not gain an unintended new-thread control.
