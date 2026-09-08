---
status: draft
---

# Switch to existing project on duplicate sidebar drop

Goal: When a folder is dropped on the sidebar and its path already belongs to an existing project, select that project instead of attempting to create it and showing an error.

Implementation: Reuse the existing workspace-path comparison helper, check conversation group folders before the create call, and invoke the existing project selection handler on a match. Preserve current behavior for new folders.

Verification: Add or update a focused regression test if the sidebar/path helper test structure supports it, then run targeted tests plus TypeScript checking as appropriate. No new dependencies or unrelated changes.
