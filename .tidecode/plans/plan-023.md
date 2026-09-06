---
status: draft
---

# Prevent project watcher EBUSY on unrelated sibling files

Goal: stop the saved-project watcher from attempting to watch unrelated entries in project parent directories, such as locked Microsoft Office .tmp files on the Desktop, while preserving project rename/delete detection and polling fallback.

Changes:
- In electron/history/projectPathWatch.ts, compute normalized parent watch targets and tracked project paths.
- Configure Chokidar's ignored callback so only each watched parent directory and the tracked project directory entries under it are considered. Unrelated siblings are ignored before native watch setup.
- Keep existing error fallback and polling behavior unchanged.
- Add a focused regression test for the path filter if it can be isolated cleanly without broad refactoring.

Verification:
- Run the focused test.
- Run npm run typecheck.
- Run npm run build.

Scope: watcher filtering only, no unrelated cleanup or dependency updates.
