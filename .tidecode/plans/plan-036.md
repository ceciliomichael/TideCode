---
status: implementation_started
---

# Goal

Remember each workspace tab's viewport so switching between preview tabs or code-editor tabs restores the exact place the user left, without resetting scroll or document positioning.

## Findings

- `src/components/workspaceExplorer/WorkspaceFileTabsPanel.tsx` renders only the active workspace tab, so preview DOM scroll containers are unmounted when changing tabs.
- `src/components/workspaceExplorer/workspaceFileTabsPanel/WorkspaceFileTabsPanelContent.tsx` selects among Markdown, plan, SVG, image, PDF, DOCX, binary, and Monaco editor content.
- Preview scroll state currently lives only in each component's DOM. The Markdown and plan previews use normal vertical overflow containers; PDF, DOCX, and image previews use the shared document-canvas interaction hook; SVG has its own overflow container.
- The Monaco wrapper already enables `keepCurrentModel` and `saveViewState`, which should preserve editor cursor/scroll per model, but this behavior should be covered and retained while adding the common tab viewport behavior.
- Workspace tab identity is already available as `WorkspaceTab.tabKey`; the state should be keyed by that stable value and discarded when a tab closes.

## Plan

### 1. Add shared per-tab viewport state

**Create** a workspace-explorer scroll/view-state utility (exact filename to follow the repository naming convention, expected under `src/components/workspaceExplorer/`).

- Expose a provider/context or equivalent hook owned by `WorkspaceFileTabsPanel`.
- Store horizontal and vertical scroll offsets by `tabKey`, using refs for the live map so scroll events do not rerender the panel on every pixel.
- Provide a small hook for a scrollable preview to register its viewport, restore the saved offsets after mount/content layout, and update the saved offsets on scroll.
- Clamp restored values to the viewport's current scrollable range, and re-apply after asynchronous preview content finishes rendering so PDF/DOCX/Markdown layouts do not lose the saved position.
- Remove entries for tabs no longer present to avoid retaining closed-tab DOM state indefinitely.
- Keep this state in memory with the current workspace panel session; do not add persistence to disk or application settings.

### 2. Integrate all DOM-based workspace tab views

**Modify**:
- `src/components/workspaceExplorer/WorkspaceFileTabsPanel.tsx`
- `src/components/workspaceExplorer/workspaceFileTabsPanel/WorkspaceFileTabsPanelContent.tsx`
- `src/components/workspaceExplorer/workspaceMarkdownPreview/WorkspaceMarkdownPreviewView.tsx`
- `src/components/workspaceExplorer/workspacePlanPreview/WorkspacePlanPreview.tsx`
- `src/components/workspaceExplorer/workspaceSvgPreview/WorkspaceSvgPreviewView.tsx`
- `src/components/workspaceExplorer/workspaceImagePreview/WorkspaceImagePreviewView.tsx`
- `src/components/workspaceExplorer/workspacePdfPreview/WorkspacePdfPreviewView.tsx`
- `src/components/workspaceExplorer/workspaceDocxPreview/WorkspaceDocxPreviewView.tsx`

Wire the active tab's stable key into each view and attach the shared restoration hook to the actual scrolling element. For image/PDF/DOCX views, compose the shared hook with the existing pan/zoom hook rather than replacing pointer, wheel, zoom, or drag behavior. Preserve each view's current zoom and rendering behavior; only viewport restoration is in scope.

If the current component boundaries make the tab key unavailable, thread it through the existing preview wrapper props from `WorkspaceFileTabsPanelContent` rather than deriving a new identity from display names or paths.

### 3. Preserve Monaco editor view state

**Modify if needed**:
- `src/components/workspaceExplorer/workspaceFileEditor/useWorkspaceMonacoEditor.ts`
- `src/components/workspaceExplorer/workspaceFileEditor/WorkspaceMonacoEditorView.tsx`

Verify that Monaco's model path remains stable per `tabKey`/file and that `keepCurrentModel` plus `saveViewState` restores editor scroll position when the editor is remounted. Only add explicit capture/restore plumbing if inspection or tests show Monaco's built-in state is insufficient; do not duplicate Monaco view state in the generic DOM scroll map.

### 4. Tests and verification

**Create or modify** focused workspace tests under `tests/` (exact placement based on the existing test conventions).

Cover:
- a tab's saved `scrollTop`/`scrollLeft` is restored after switching away and back;
- separate tabs do not share viewport state;
- a tab's state is removed when that tab closes;
- restoration tolerates content height changing after initial mount;
- horizontal scroll is preserved for zoomed/pannable document previews;
- Monaco editor tabs retain their model view state/scroll behavior.

Run the smallest relevant checks: the new focused tests, `npm run typecheck`, and the relevant lint/build check if the repository exposes one. Acceptance is that switching among any supported workspace tabs restores the prior viewport, including code editor tabs, without visible reset or regression to existing preview controls.

## Scope and risks

- In scope: per-tab in-memory scroll offsets for all workspace explorer tab kinds and confirmation of Monaco's existing per-model view-state behavior.
- Out of scope: persisting scroll positions across application restarts, changing tab selection semantics, changing preview rendering, or keeping every tab mounted.
- Main risk: asynchronous document rendering can clamp or overwrite restoration too early; restore on mount and after relevant content/layout changes, while keeping the handler lightweight.
- Performance: use refs and passive scroll listeners where compatible; avoid React state updates per scroll event and avoid retaining closed tab entries.
