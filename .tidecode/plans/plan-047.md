---
status: implementation_started
---

# Goal
Make the chat interface’s “No repo” state visually consistent with the enabled Git branch control, rather than showing disabled-state text coloring merely because no repository is present.

## Findings
`src/components/chat/GitBranchSelectorField.tsx` renders “No repo” through the same button as the current branch and sets `disabled` when `!hasRepository`. `src/index.css` applies `--color-disabled-foreground` to every disabled `.chat-runtime-control-trigger`, so the label and branch icon inherit disabled color. The control’s normal foreground is `--color-muted-foreground`; no focused test for this field was found. This is a localized styling correction, not an architecture or design-system change, so `ARCHITECTURE.md` and `DESIGN.md` need no changes.

## Planned files
- **Modify** `src/components/chat/GitBranchSelectorField.tsx` — add a narrowly scoped class/condition for the no-repository presentation so “No repo” retains the normal muted control color while the control remains semantically disabled and non-interactive. Preserve disabled styling for other disabled reasons/states.

## Expected structure
```text
src/components/chat/
└── GitBranchSelectorField.tsx  (modify)
```

## Implementation and verification
1. Adjust the selector trigger’s class logic specifically for `!hasRepository`, avoiding a global disabled-control CSS change that would affect unrelated controls. Keep native `disabled` semantics and cursor behavior intact.
2. Verify the resulting classes/state in source and run the narrowest applicable lint/typecheck or test command available from `package.json`. Confirm repository absence still disables interaction, while the text and icon use the expected normal muted foreground; confirm other disabled conditions are unchanged.
