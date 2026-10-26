---
name: diff-panel-design
description: Approved Source Control styling for Diff panel file rows, scoped behavior and header divider rendering.
---

- Diff panel file rows match Source Control: 49-pixel collapsed rows, file-type icons, compact names, Git-colored status letters instead of inline line counts, deleted-name strikethrough, subtle separators, hover backgrounds and right-aligned actions.
- Diff panel filename tooltips open to the left, like Source Control. Other path labels retain their existing tooltip placement.
- Preserve expansion, on-demand previews, scoped stage/unstage/discard actions and stable header alignment while loading. Ordinary inline chat diffs retain their existing appearance.
- `ConversationDiffFileItem` supplies file-change metadata through `DiffViewer` to `DiffFileHeader`; panel row heights and virtualization use `PANEL_DIFF_ROW_HEIGHT_PX`.
- Source Control and Diff panel title headers use CSS bottom borders, not separate `h-px bg-border` filled elements, to match other separators.
