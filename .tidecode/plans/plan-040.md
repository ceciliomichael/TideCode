---
status: draft
---

# Fix CLI multiline keys and queue redraw

Goal: make Shift+Enter and Alt+Enter insert a newline in the CLI composer on Windows terminals, and prevent queue submission from leaving the live frame corrupted.

Changes:
- Decode modified Enter reliably, including Windows ConPTY Win32 input records and CSI-u/legacy modified Enter sequences.
- Enable Win32 input mode only while the interactive CLI owns raw stdin on Windows, and restore the terminal mode on exit.
- Route decoded key records through the existing composer actions so queue/steer behavior remains unchanged.
- Add regression tests for Shift+Enter, Alt+Enter, Windows modified Enter records, and queue submission with multiline composer content/frame redraw.

Verification:
- Run focused terminal input/screen tests.
- Run typecheck and diff check.

Scope: CLI input and live-frame behavior only. No changes to follow-up semantics or model/runtime messages.
